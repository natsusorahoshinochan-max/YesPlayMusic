import 'fake-indexeddb/auto';
import request, { configureRequest } from '@/utils/request';
import { createStore } from '@/store';
import { startApplication } from '@/application/startup';
import { configureMusicData } from '@/application/musicData';
import { createPlayer } from '@/application/player';

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function setup(options = {}, playerOptions = {}) {
  configureMusicData({ getSettings: () => ({}), getIdentity: () => ({}) });
  let position = 0;
  const store = {
    state: {},
    getters: {
      'preferences/settings': {},
      'library/user': {},
      'session/hasAccount': false,
      'lastfm/authorization': {},
    },
    dispatch: jest.fn(),
    subscribe: () => () => {},
  };
  const player = createPlayer({
    store,
    platform: { publish() {}, progress() {}, dispose() {} },
    storage: { getItem: () => null, setItem() {} },
    getTrack: async id => ({ id, name: 'Song', ar: [], al: {}, dt: 60000 }),
    resources: {
      resolve: async () => ({ url: 'audio', sourceInfo: { from: 'netease' } }),
    },
    audio: {
      prepare: async (_, events) => ({
        play: () => events.onPlay(),
        pause: () => events.onPause(),
        seek: value => {
          position = value;
        },
        position: () => position,
        setVolume() {},
        dispose() {},
      }),
    },
    lyricsOptions: {
      getLyric: async () => ({
        lrc: { lyric: '[00:00.00]one\n[00:02.00]two' },
        tlyric: { lyric: '[00:02.00]二' },
        romalrc: { lyric: '[00:02.00]ni' },
      }),
      ...options,
    },
    ...playerOptions,
  });
  return player;
}
afterEach(() => jest.useRealTimers());
test('assembled lyrics aligns content and follows seek with one consumer clock independently of page visibility', async () => {
  jest.useFakeTimers();
  const player = setup();
  const release = player.lyrics.consume();
  await player.playTracks([1]);
  await flush();
  expect(player.lyrics.state.translation[1].contents).toEqual(['two', '二']);
  expect(player.lyrics.state.romanization[1].contents).toEqual(['two', 'ni']);
  expect(player.lyrics.state.currentLine).toBe('one');
  player.seek(3);
  expect(player.lyrics.state.currentLine).toBe('two');
  release();
  player.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

test('Linux complete publication writes shared raw content before metadata and rejects stale handshakes', async () => {
  const handlers = {};
  const sent = [];
  const player = setup(
    {},
    {
      platform: undefined,
      platformOptions: {
        ipc: {
          on: (name, cb) => {
            handlers[name] = cb;
          },
          removeListener() {},
          send: (name, payload) => sent.push([name, payload]),
        },
        navigator: {},
        window,
        document,
        createMpris: true,
        createTray: false,
      },
      getSettings: () => ({ enableOsdlyricsSupport: true }),
    }
  );
  await player.playTracks([1]);
  await flush();
  const first = sent.find(([name]) => name === 'sendLyrics')[1];
  expect(first.lyrics).toContain('two');
  expect(sent.filter(([name]) => name === 'metadata')).toEqual([]);
  await player.playTracks([2]);
  await flush();
  handlers.saveLyricFinished({}, first.requestId);
  expect(sent.filter(([name]) => name === 'metadata')).toEqual([]);
  const latest = sent.filter(([name]) => name === 'sendLyrics').pop()[1];
  handlers.saveLyricFinished({}, latest.requestId);
  expect(sent.filter(([name]) => name === 'metadata').pop()[1].trackId).toBe(2);
  player.dispose();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function realApplication(
  read,
  { profile = async id => ({ userId: id }), platformOptions } = {}
) {
  const storage = { getItem: () => null, setItem() {} };
  let token;
  let account = 10;
  const credentials = {
    get: () => token,
    set: value => {
      token = value;
    },
    remove: () => {
      token = null;
    },
  };
  request.defaults.adapter = async config => {
    try {
      return { config, status: 200, data: await read(config), headers: {} };
    } catch (error) {
      error.config = config;
      throw error;
    }
  };
  const api = {
    userAccount: async () => ({ code: 200, profile: await profile(account) }),
    userPlaylist: async () => ({ playlist: [] }),
    userLikedSongsIDs: async () => ({ ids: [] }),
    likedAlbums: async () => ({ data: [] }),
    likedArtists: async () => ({ data: [] }),
    likedMVs: async () => ({ data: [] }),
    cloudDisk: async () => ({ data: [] }),
  };
  const store = createStore({
    storage,
    credentials,
    session: {
      auth: { loginWithEmail: async () => ({ code: 200, cookie: 'cookie' }) },
    },
    library: { api },
  });
  let position = 0;
  const player = await startApplication({
    createStore: () => store,
    initializeLocale: () => ({}),
    initializeAppearance() {},
    configureRequest,
    getCookie: credentials.get,
    onSessionInvalid: () => store.dispatch('session/invalidate'),
    requestEnvironment: { baseURL: '', configure: config => config },
    initializeDependencies: (_, reads) => configureMusicData(reads),
    createPlayer: args =>
      createPlayer({
        ...args,
        storage,
        platform: platformOptions
          ? undefined
          : { publish() {}, progress() {}, dispose() {} },
        platformOptions,
        getSettings: () => ({
          ...args.getSettings(),
          enableOsdlyricsSupport: true,
        }),
        getTrack: async id => ({
          id,
          name: 'Cloud',
          pc: {},
          cd: null,
          ar: [],
          al: {},
          dt: 60000,
        }),
        resources: {
          resolve: async () => ({
            url: 'audio',
            sourceInfo: { from: 'netease' },
          }),
        },
        audio: {
          prepare: async (_, events) => ({
            play: () => events.onPlay(),
            pause: () => events.onPause(),
            seek: value => {
              position = value;
            },
            position: () => position,
            setVolume() {},
            dispose() {},
          }),
        },
      }),
    mount: ({ store: mounted }) => mounted.state.player,
  });
  return {
    player,
    store,
    login: async id => {
      account = id;
      await store.dispatch('session/loginWithPassword', {
        mode: 'email',
        email: 'test',
        password: 'secret',
      });
    },
  };
}
const settleIO = () => new Promise(resolve => setTimeout(resolve, 25));
test('real account A/B entry and local logout invalidate pending cloud requests through startup assembly', async () => {
  const pendingA = deferred();
  const reads = [];
  const app = await realApplication(async config => {
    reads.push(config);
    if (config.url === '/personal_fm') return { data: [] };
    if (config.url === '/lyric') return { lrc: { lyric: '[00:00.00]guest' } };
    if (config.params.data.userId === 10) return pendingA.promise;
    return { lrc: '[00:00.00]B cloud' };
  });
  await app.login(10);
  await app.player.playTracks([820032]);
  await settleIO();
  await app.login(20);
  await settleIO();
  expect(app.player.lyrics.state.currentLine).toBe('B cloud');
  pendingA.resolve({ lrc: '[00:00.00]A late' });
  await settleIO();
  expect(app.player.lyrics.state.currentLine).toBe('B cloud');
  await app.store.dispatch('session/logout');
  await settleIO();
  expect(app.player.lyrics.state.currentLine).toBe('guest');
  expect(reads.some(config => config.url === '/lyric')).toBe(true);
  app.player.dispose();
});

test('empty and failed current content clears old lines, retry restores it and disposal rejects late reads', async () => {
  const late = deferred();
  const getLyric = jest
    .fn()
    .mockResolvedValueOnce({ lrc: { lyric: '[00:00.00]old' } })
    .mockResolvedValueOnce({ lrc: { lyric: '' } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ lrc: { lyric: '[00:00.00]retried' } })
    .mockImplementationOnce(() => late.promise);
  const player = setup({ getLyric });
  await player.playTracks([1]);
  await flush();
  expect(player.lyrics.state.currentLine).toBe('old');
  await player.playTracks([2]);
  await flush();
  expect(player.lyrics.state).toMatchObject({
    status: 'empty',
    currentLine: '',
    raw: '',
  });
  await player.playTracks([3]);
  await flush();
  expect(player.lyrics.state).toMatchObject({
    status: 'failed',
    currentLine: '',
    raw: '',
  });
  expect(player.state.playing).toBe(true);
  await player.lyrics.retry();
  expect(player.lyrics.state.currentLine).toBe('retried');
  await player.playTracks([4]);
  await flush();
  expect(player.lyrics.state.currentLine).toBe('');
  player.dispose();
  late.resolve({ lrc: { lyric: '[00:00.00]disposed' } });
  await flush();
  expect(player.lyrics.state.currentLine).toBe('');
});

test('cloud transport failure remains retryable instead of becoming a legal empty response', async () => {
  let failed = true;
  const app = await realApplication(async config => {
    if (config.url === '/personal_fm') return { data: [] };
    if (failed) throw new Error('network');
    return { lrc: '[00:00.00]restored' };
  });
  await app.login(30);
  await app.player.playTracks([820033]);
  await settleIO();
  expect(app.player.lyrics.state.status).toBe('failed');
  failed = false;
  await app.player.lyrics.retry();
  expect(app.player.lyrics.state.currentLine).toBe('restored');
  app.player.dispose();
});

test('hidden page keeps Touch Bar synchronized without duplicate clocks or repeated current-line pushes', async () => {
  jest.useFakeTimers();
  const sent = [];
  const onProgress = jest.fn();
  const player = setup(
    {},
    {
      platform: undefined,
      onProgress,
      platformOptions: {
        ipc: {
          on() {},
          removeListener() {},
          send: (channel, payload) => sent.push([channel, payload]),
        },
        navigator: {},
        window,
        document,
        createMpris: false,
        createTray: false,
      },
    }
  );
  await player.playTracks([1]);
  await flush();
  const timerCount = jest.getTimerCount();
  const hidePage = player.lyrics.consume();
  const releaseOtherConsumer = player.lyrics.consume();
  expect(jest.getTimerCount()).toBe(timerCount);
  hidePage();
  releaseOtherConsumer();
  const messages = () => sent.filter(([channel]) => channel === 'updateLyric');
  const count = messages().length;
  const progressCount = onProgress.mock.calls.length;
  jest.advanceTimersByTime(200);
  expect(messages()).toHaveLength(count);
  expect(onProgress).toHaveBeenCalledTimes(progressCount);
  player.seek(3);
  expect(messages().pop()[1]).toEqual({ lyric: 'two' });
  player.pause();
  expect(jest.getTimerCount()).toBe(timerCount - 1);
  player.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

test('Linux clears raw content on empty/failure and a missing native acknowledgement settles without late publication', async () => {
  jest.useFakeTimers();
  const sent = [];
  const handlers = {};
  const player = setup(
    { getLyric: async () => ({ lrc: { lyric: '' } }) },
    {
      platform: undefined,
      getSettings: () => ({ enableOsdlyricsSupport: true }),
      platformOptions: {
        ipc: {
          on: (channel, handler) => {
            handlers[channel] = handler;
          },
          removeListener() {},
          send: (channel, payload) => sent.push([channel, payload]),
        },
        navigator: {},
        window,
        document,
        createMpris: true,
        createTray: false,
      },
    }
  );
  await player.playTracks([1]);
  await flush();
  const emptyWrite = sent.filter(([channel]) => channel === 'sendLyrics').pop();
  expect(emptyWrite?.[1].lyrics).toBe('');
  expect(sent.filter(([channel]) => channel === 'metadata')).toHaveLength(0);
  jest.advanceTimersByTime(5000);
  expect(sent.filter(([channel]) => channel === 'metadata')).toHaveLength(1);
  player.dispose();
  handlers.saveLyricFinished({}, emptyWrite[1].requestId);
  expect(sent.filter(([channel]) => channel === 'metadata')).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('starting a successful account replacement clears lyrics before the next account profile is available', async () => {
  const profileB = deferred();
  const app = await realApplication(
    async config => {
      if (config.url === '/personal_fm') return { data: [] };
      return { lrc: '[00:00.00]account lyrics' };
    },
    {
      profile: id =>
        id === 42 ? profileB.promise : Promise.resolve({ userId: id }),
    }
  );
  await app.login(41);
  await app.player.playTracks([820034]);
  await settleIO();
  expect(app.player.lyrics.state.currentLine).toBe('account lyrics');
  const replacing = app.login(42);
  await flush();
  expect(app.player.lyrics.state.currentLine).toBe('');
  profileB.resolve({ userId: 42 });
  await replacing;
  await settleIO();
  expect(app.player.lyrics.state.currentLine).toBe('account lyrics');
  app.player.dispose();
});

test('late unauthorized cloud read from account A cannot log account B out', async () => {
  const old = deferred();
  const app = await realApplication(async config => {
    if (config.url === '/personal_fm') return { data: [] };
    if (config.params.data.userId === 51) return old.promise;
    return { lrc: '[00:00.00]B authorized' };
  });
  await app.login(51);
  await app.player.playTracks([820035]);
  await settleIO();
  await app.login(52);
  await settleIO();
  old.reject({ response: { data: { code: 301, msg: '需要登录' } } });
  await settleIO();
  expect(app.store.getters['session/hasAccount']).toBe(true);
  expect(app.store.getters['library/user'].userId).toBe(52);
  expect(app.player.lyrics.state.currentLine).toBe('B authorized');
  app.player.dispose();
});

test('real cloud API content feeds the full Linux writer and native acknowledgement releases metadata', async () => {
  const sent = [];
  const handlers = {};
  const app = await realApplication(
    async config => {
      if (config.url === '/personal_fm') return { data: [] };
      expect(config.url).toBe('/api');
      return { lrc: '[00:00.00]cloud raw' };
    },
    {
      platformOptions: {
        ipc: {
          on: (channel, handler) => {
            handlers[channel] = handler;
          },
          removeListener() {},
          send: (channel, payload) => sent.push([channel, payload]),
        },
        navigator: {},
        window,
        document,
        createMpris: true,
        createTray: false,
        createTouchBar: false,
      },
    }
  );
  await app.login(61);
  await app.player.playTracks([820036]);
  await settleIO();
  const write = sent.filter(([channel]) => channel === 'sendLyrics').pop()[1];
  expect(write.lyrics).toBe('[00:00.00]cloud raw');
  expect(sent.filter(([channel]) => channel === 'metadata')).toHaveLength(0);
  // The native writer acknowledges both successful and failed DBus writes.
  handlers.saveLyricFinished({}, write.requestId);
  expect(
    sent.filter(([channel]) => channel === 'metadata').pop()[1].trackId
  ).toBe(820036);
  app.player.dispose();
});
