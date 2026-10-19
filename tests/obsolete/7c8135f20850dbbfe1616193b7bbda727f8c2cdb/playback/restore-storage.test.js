import { createPlayer } from '@/application/player';

function fixture(saved = {}, options = {}) {
  const values = new Map(Object.entries(saved));
  const writes = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      values.set(key, String(value));
      writes.push([key, String(value)]);
    },
  };
  const store = options.store || {
    state: { library: { collections: { songs: [] } } },
    getters: { 'preferences/settings': {}, 'session/hasAccount': false },
    dispatch: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
  };
  let sample;
  const handles = [];
  const player = createPlayer({
    store,
    storage,
    platform: { publish: jest.fn(), progress: jest.fn(), dispose: jest.fn() },
    getTrack: async id => ({ id, name: 'Track', dt: 100000, ar: [], al: {} }),
    resources: { resolve: async () => ({ kind: 'url', url: 'https://audio' }) },
    personalFM: { load: async () => [{ id: 80 }, { id: 81 }] },
    audio: {
      prepare: async (resource, options) => {
        let position = options.position;
        const handle = {
          play: () => options.onPlay(),
          pause: () => options.onPause(),
          seek: n => {
            position = n;
          },
          position: () => position,
          setVolume() {},
          dispose: jest.fn(),
          applyOutputDevice: jest.fn(),
        };
        handles.push(handle);
        return handle;
      },
    },
    setInterval: callback => {
      sample = callback;
      return 1;
    },
    clearInterval: jest.fn(),
    ...options,
  });
  return { player, storage, writes, sample: () => sample(), handles, store };
}

test('legacy restore preserves queue, modes, muted volume and sampled progress without autoplay', async () => {
  const f = fixture({
    player: JSON.stringify({
      _enabled: true,
      _list: [1, 2, 3],
      _current: 1,
      _shuffledList: [3, 2, 1],
      _shuffledCurrent: 1,
      _currentTrack: { id: 2 },
      _playlistSource: { type: 'album', id: 5 },
      _playNextList: [9, 8],
      _volume: 0,
      _volumeBeforeMuted: 0.4,
      _shuffle: true,
      _repeatMode: 'on',
      _reversed: true,
      _personalFMTrack: { id: 80 },
      _personalFMNextTrack: { id: 81 },
      _howler: 'temporary',
    }),
    playerCurrentTrackTime: '12.5',
  });
  await f.player.restoreSaved();
  expect(f.player.state).toMatchObject({
    currentTrackID: 2,
    progress: 12.5,
    playing: false,
    volume: 0,
    shuffle: true,
    reversed: true,
    repeatMode: 'on',
  });
  expect(f.player.upcoming(4).map(row => row.trackId)).toEqual([9, 8, 3, 1]);
  f.player.toggleMute();
  expect(f.player.state.volume).toBe(0.4);
  const archive = JSON.parse(f.storage.getItem('player'));
  expect(archive._shuffledList).toEqual([3, 2, 1]);
  expect(archive).not.toHaveProperty('_howler');
  f.player.dispose();
});

test('queue array edits persist while progress and runtime audio transitions only update their outputs', async () => {
  const f = fixture();
  await f.player.playTracks([1, 2]);
  f.player.enqueueNext(9);
  f.player.enqueueNext(8);
  f.player.removeNext(0);
  expect(JSON.parse(f.storage.getItem('player'))._playNextList).toEqual([8]);
  const savedCount = f.writes.filter(([key]) => key === 'player').length;
  f.player.pause();
  f.player.play();
  f.player.seek(17.5);
  f.sample();
  expect(f.storage.getItem('playerCurrentTrackTime')).toBe('17.5');
  expect(f.writes.filter(([key]) => key === 'player')).toHaveLength(savedCount);
  f.player.clearNext();
  expect(JSON.parse(f.storage.getItem('player'))._playNextList).toEqual([]);
  f.player.dispose();
});

test('cold FM loading publishes temporary state and disposed selection ends quietly', async () => {
  let finish;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const states = [];
  // Use the public restore/selection boundary with a controlled remote FM response.
  const { createPlayback } = require('@/playback');
  const player = createPlayback({
    personalFM: { load: () => pending },
    onStateChange: state => states.push(state),
    setInterval: () => 1,
    clearInterval() {},
  });
  const selection = player.playPersonalFM();
  await Promise.resolve();
  expect(states.some(state => state.personalFMLoading)).toBe(true);
  player.dispose();
  finish([{ id: 80 }, { id: 81 }]);
  expect(await selection).toEqual({ status: 'superseded' });
});

test('startup configures requests and dependencies before one attributed restore, preferences and mount', async () => {
  const { startApplication } = require('@/application/startup');
  const order = [];
  const f = fixture({
    player: JSON.stringify({
      _enabled: true,
      _currentTrack: { id: 2 },
      _list: [2],
    }),
  });
  f.store.dispatch = async type => {
    order.push(type);
  };
  await startApplication({
    createStore: () => f.store,
    initializeLocale: () => ({}),
    configureRequest: () => order.push('request'),
    initializeDependencies: async () => order.push('dependencies'),
    initializeAppearance: () => order.push('appearance'),
    createPlayer: () => {
      order.push('player');
      return f.player;
    },
    mount: ({ store }) => {
      order.push('mount');
      expect(store.state.player).toBe(f.player);
    },
  });
  expect(order).toEqual([
    'request',
    'dependencies',
    'player',
    'preferences/applyRestored',
    'appearance',
    'mount',
  ]);
  await Promise.resolve();
  expect(f.player.state.currentTrackID).toBe(2);
  f.player.dispose();
});

test('real preference actions apply the selected device and clear reversed playback', async () => {
  const { createStore } = require('@/store');
  const {
    createPreferenceEffects,
  } = require('@/application/preferenceEffects');
  const { createAudioAdapter } = require('@/playback/audioAdapter');
  const sink = jest.fn(async () => {});
  class Howl {
    constructor() {
      this.listeners = {};
      this._sounds = [{ _node: { setSinkId: sink } }];
      this.time = 0;
    }
    on(name, callback) {
      this.listeners[name] = callback;
    }
    off() {}
    load() {
      this.listeners.load();
    }
    play() {
      this.listeners.play();
    }
    pause() {
      this.listeners.pause();
    }
    seek(value) {
      if (value !== undefined) this.time = value;
      return this.time;
    }
    volume() {}
    unload() {}
  }
  let player;
  const store = createStore({
    preferences: createPreferenceEffects({
      getPlayer: () => player,
      getLocale: () => ({}),
      ipcRenderer: null,
    }),
  });
  const f = fixture(
    {},
    {
      store,
      audio: createAudioAdapter({
        Howl,
        outputDevice: () => store.getters['preferences/settings'].outputDevice,
      }),
    }
  );
  player = f.player;
  await player.playTracks([1, 2, 3]);
  player.setReversed(true);
  await store.dispatch('preferences/setOutputDevice', 'headphones');
  expect(sink).toHaveBeenLastCalledWith('headphones');
  await store.dispatch('preferences/setReversedModeEnabled', false);
  expect(player.state.reversed).toBe(false);
  expect(player.upcoming(2).map(row => row.trackId)).toEqual([2, 3]);
  player.dispose();
});

test('library favorite changes regenerate desktop projection and dispose releases its subscription', async () => {
  const { createStore } = require('@/store');
  const store = createStore();
  const platform = {
    publish: jest.fn(),
    progress: jest.fn(),
    dispose: jest.fn(),
  };
  const f = fixture({}, { store, platform });
  await f.player.playTracks([2]);
  expect(platform.publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ currentTrackID: 2 }),
    false
  );
  store.commit('library/setCollection', { name: 'songs', data: [2] });
  expect(platform.publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ currentTrackID: 2 }),
    true
  );
  f.player.dispose();
  const count = platform.publish.mock.calls.length;
  store.commit('library/setCollection', { name: 'songs', data: [] });
  expect(platform.publish).toHaveBeenCalledTimes(count);
  expect(platform.dispose).toHaveBeenCalledTimes(1);
  expect(f.handles[0].dispose).toHaveBeenCalledTimes(1);
  f.player.dispose();
  expect(platform.dispose).toHaveBeenCalledTimes(1);
});

test('user selection supersedes both pending restored audio and cold FM initialization', async () => {
  let finishTrack;
  let finishFM;
  const restoredTrack = new Promise(resolve => {
    finishTrack = resolve;
  });
  const recommendations = new Promise(resolve => {
    finishFM = resolve;
  });
  const f = fixture(
    {
      player: JSON.stringify({
        _enabled: true,
        _list: [2],
        _currentTrack: { id: 2 },
      }),
      playerCurrentTrackTime: '15',
    },
    {
      getTrack: id =>
        id === 2 ? restoredTrack : Promise.resolve({ id, dt: 100000 }),
      personalFM: { load: () => recommendations },
    }
  );
  const restoration = f.player.restoreSaved();
  await Promise.resolve();
  const selected = f.player.playTracks([7]);
  await selected;
  finishTrack({ id: 2, dt: 100000 });
  finishFM([{ id: 80 }, { id: 81 }]);
  expect(await restoration).toEqual({ status: 'superseded' });
  await Promise.resolve();
  expect(f.player.state).toMatchObject({
    currentTrackID: 7,
    progress: 0,
    playing: true,
    personalFMTrack: { id: 0 },
  });
  expect(f.handles).toHaveLength(1);
  f.player.dispose();
});

test('saved personal FM restores its current and next tracks while preserving the ordinary queue', async () => {
  const f = fixture({
    player: JSON.stringify({
      _enabled: true,
      _list: [1, 2],
      _current: 1,
      _currentTrack: { id: 80 },
      _playlistSource: { type: 'personalFM', id: 0 },
      _isPersonalFM: true,
      _personalFMTrack: { id: 80, name: 'FM' },
      _personalFMNextTrack: { id: 81 },
      _playNextList: [9],
    }),
    playerCurrentTrackTime: '8',
  });
  await f.player.restoreSaved();
  expect(f.player.state).toMatchObject({
    currentTrackID: 80,
    isPersonalFM: true,
    progress: 8,
    playing: false,
  });
  expect(f.player.upcoming(1)[0]).toMatchObject({
    trackId: 81,
    personalFM: true,
  });
  await f.player.next();
  expect(f.player.state.currentTrackID).toBe(81);
  expect(f.player.archive()).toMatchObject({
    _list: [1, 2],
    _current: 1,
    _playNextList: [9],
  });
  f.player.dispose();
});

test('assembled platform receives track metadata before audio readiness and controls the shared Playback', async () => {
  const messages = [];
  const listeners = {};
  const ipc = {
    send: (type, value) => messages.push([type, value]),
    on: (name, callback) => {
      listeners[name] = callback;
    },
    removeListener: jest.fn(),
  };
  let finish;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const f = fixture(
    {},
    {
      platform: undefined,
      platformOptions: {
        ipc,
        createTray: true,
        createMpris: true,
        getLyric: async () => ({}),
      },
      resources: { resolve: () => pending },
    }
  );
  const selection = f.player.playTracks([2]);
  await Promise.resolve();
  await Promise.resolve();
  expect(
    messages.some(
      ([type, value]) =>
        type === 'player' &&
        value.currentTrackID === 2 &&
        value.sourceInfo === null
    )
  ).toBe(true);
  finish({ kind: 'url', url: 'https://audio' });
  await selection;
  expect(messages.filter(([type]) => type === 'player').pop()[1].playing).toBe(
    true
  );
  listeners.play();
  expect(f.player.state.playing).toBe(false);
  f.player.seek(22);
  expect(messages).toContainEqual(['seeked', 22]);
  f.player.dispose();
  expect(ipc.removeListener).toHaveBeenCalled();
});
