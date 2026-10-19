import { createAudioAdapter } from '@/playback/audioAdapter';
import { createPlayback } from '@/playback';
import { createAudioResources } from '@/playback/audioResources';

function boundary({ load, sink } = {}) {
  const actions = [];
  const instances = [];
  class Howl {
    constructor(options) {
      this.options = options;
      this.events = {};
      this.time = 0;
      this._sounds = [
        {
          _node: {
            setSinkId: jest.fn(
              sink || (async device => actions.push(['sink', device]))
            ),
          },
        },
      ];
      instances.push(this);
    }
    on(name, fn) {
      this.events[name] = fn;
      return this;
    }
    off(name, fn) {
      actions.push(['off', name]);
      if (this.events[name] === fn) delete this.events[name];
      return this;
    }
    emit(name, ...args) {
      this.events[name]?.(...args);
    }
    load() {
      if (load) load(this);
      else this.emit('load');
    }
    unload() {
      actions.push(['unload', this.options.src[0]]);
    }
    play() {
      actions.push(['play']);
      this.emit('play');
    }
    pause() {
      this.emit('pause');
    }
    seek(value) {
      if (value !== undefined) this.time = value;
      return this.time;
    }
    volume(value) {
      this.level = value;
    }
  }
  const URL = {
    createObjectURL: jest.fn(
      () => `blob:owned-${URL.createObjectURL.mock.calls.length}`
    ),
    revokeObjectURL: jest.fn(url => actions.push(['revoke', url])),
  };
  return {
    actions,
    instances,
    URL,
    audio: createAudioAdapter({ Howl, URL, outputDevice: () => 'speakers' }),
  };
}
const bytes = { kind: 'bytes', bytes: new Uint8Array([1, 2]).buffer };

test('initial network load failure gets a fresh source and restores the selected position without autoplay', async () => {
  const { audio, instances, URL, actions } = boundary({
    load: howl => {
      if (howl.options.src[0].startsWith('blob:')) howl.emit('loaderror', 1, 2);
      else howl.emit('load');
    },
  });
  const cache = {
    getTrackSource: jest
      .fn()
      .mockResolvedValueOnce({ source: bytes.bytes })
      .mockResolvedValue(null),
  };
  let finishPrefetch;
  const prefetched = new Promise(resolve => {
    finishPrefetch = resolve;
  });
  const getMP3 = jest.fn(async id => {
    if (id === 2) finishPrefetch();
    return { data: [{ url: `https://fresh/${id}`, freeTrialInfo: null }] };
  });
  const feedback = jest.fn();
  const playback = createPlayback({
    getTrack: async id => ({ id, dt: 180000 }),
    resources: createAudioResources({ cache, getMP3, hasAccount: () => true }),
    audio,
    onFeedback: feedback,
    setInterval: () => 1,
    clearInterval() {},
  });
  expect(
    await playback.restore(
      { _enabled: true, _list: [1, 2], _currentTrack: { id: 1 } },
      17
    )
  ).toEqual({ status: 'completed' });
  expect(playback.state.currentTrackID).toBe(1);
  expect(playback.position()).toBe(17);
  expect(playback.state.playing).toBe(false);
  expect(instances.map(h => h.options.src[0])).toEqual([
    'blob:owned-1',
    'https://fresh/1',
  ]);
  expect(URL.revokeObjectURL.mock.calls).toEqual([['blob:owned-1']]);
  expect(instances[0].events).toEqual({});
  expect(actions).toContainEqual(['unload', 'blob:owned-1']);
  await prefetched;
  expect(getMP3.mock.calls).toEqual([[1], [2]]);
  expect(feedback).not.toHaveBeenCalled();
  playback.dispose();
});

test('a newer selection owns playback while an initial audio retry rejects late without feedback', async () => {
  const { audio, instances, URL } = boundary({
    load: howl => {
      if (howl.options.src[0].startsWith('blob:')) howl.emit('loaderror', 1, 2);
      else howl.emit('load');
    },
  });
  let rejectRetry;
  let retryStarted;
  const retryRequested = new Promise(resolve => {
    retryStarted = resolve;
  });
  const getMP3 = jest.fn(id => {
    if (id === 1) {
      retryStarted();
      return new Promise((_, reject) => {
        rejectRetry = reject;
      });
    }
    return Promise.resolve({
      data: [{ url: 'https://new/2', freeTrialInfo: null }],
    });
  });
  const feedback = jest.fn();
  const events = [];
  const playback = createPlayback({
    getTrack: async id => ({ id, dt: 180000 }),
    resources: createAudioResources({
      cache: {
        getTrackSource: jest
          .fn()
          .mockResolvedValueOnce({ source: bytes.bytes })
          .mockResolvedValue(null),
      },
      getMP3,
      hasAccount: () => true,
    }),
    audio,
    onFeedback: feedback,
    onPlaybackEvent: event => events.push(event),
    setInterval: () => 1,
    clearInterval() {},
  });
  const old = playback.playTracks([1]);
  await retryRequested;
  expect(await playback.playTracks([2])).toEqual({ status: 'completed' });
  rejectRetry(new Error('expired retry'));
  expect(await old).toEqual({ status: 'superseded' });
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.playing).toBe(true);
  expect(
    events.filter(event => event.type === 'played').map(event => event.track.id)
  ).toEqual([2]);
  expect(instances).toHaveLength(2);
  expect(URL.revokeObjectURL.mock.calls).toEqual([['blob:owned-1']]);
  expect(feedback).not.toHaveBeenCalled();
  playback.dispose();
});

test('prepared bytes own their actual URL and dispose unbinds and unloads before revocation exactly once', async () => {
  const { audio, URL, actions, instances } = boundary();
  const onEnd = jest.fn();
  const handle = await audio.prepare(bytes, { onEnd });
  expect(instances[0].options.src).toEqual(['blob:owned-1']);
  instances[0].emit('end');
  expect(onEnd).toHaveBeenCalledTimes(1);
  const lateEnd = instances[0].events.end;
  handle.dispose();
  handle.dispose();
  lateEnd();
  instances[0].emit('end');
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  const revokeIndex = actions.findIndex(([name]) => name === 'revoke');
  expect(actions.findIndex(([name]) => name === 'unload')).toBeLessThan(
    revokeIndex
  );
  expect(actions.filter(([name]) => name === 'off').length).toBeGreaterThan(0);
  expect(actions.slice(revokeIndex + 1)).toEqual([]);
});

test('prepared remote audio loads then applies position, volume, device and playback events', async () => {
  const { audio, instances, URL } = boundary();
  const onPlay = jest.fn();
  const onPause = jest.fn();
  const onError = jest.fn();
  const handle = await audio.prepare(
    { kind: 'url', url: 'https://music/song.mp3' },
    { volume: 0.4, position: 12, autoplay: true, onPlay, onPause, onError }
  );
  expect(instances[0]._sounds[0]._node.setSinkId).toHaveBeenCalledWith(
    'speakers'
  );
  expect(handle.position()).toBe(12);
  expect(instances[0].level).toBe(0.4);
  expect(onPlay).toHaveBeenCalledTimes(1);
  handle.pause();
  expect(onPause).toHaveBeenCalledTimes(1);
  handle.seek(27);
  handle.setVolume(0.7);
  expect(handle.position()).toBe(27);
  expect(instances[0].level).toBe(0.7);
  handle.play();
  expect(onPlay).toHaveBeenCalledTimes(2);
  instances[0].emit('loaderror', 1, 4);
  expect(onError).toHaveBeenCalledWith({ code: 4, error: 4 });
  await handle.applyOutputDevice('headphones');
  expect(instances[0]._sounds[0]._node.setSinkId).toHaveBeenLastCalledWith(
    'headphones'
  );
  handle.dispose();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

test('load failure releases only its preparation and rejects once with the media error code', async () => {
  const { audio, URL, instances, actions } = boundary({
    load: howl => howl.emit('loaderror', 1, 3),
  });
  const onError = jest.fn();
  await expect(audio.prepare(bytes, { onError })).rejects.toEqual(
    expect.objectContaining({ code: 3, message: expect.any(String) })
  );
  expect(onError).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
  expect(actions.at(-1)).toEqual(['revoke', 'blob:owned-1']);
  expect(instances[0].events).toEqual({});
});

test('device preparation failure releases its URL while another prepared audio remains live', async () => {
  let rejectDevice;
  let calls = 0;
  const { audio, URL, instances } = boundary({
    sink: () => {
      calls++;
      return calls === 1
        ? Promise.resolve()
        : new Promise((_, reject) => {
            rejectDevice = reject;
          });
    },
  });
  const onEnd = jest.fn();
  const current = await audio.prepare(bytes, { onEnd });
  const preparing = audio.prepare(bytes);
  await Promise.resolve();
  rejectDevice(new Error('device gone'));
  await expect(preparing).rejects.toThrow('device gone');
  expect(URL.revokeObjectURL.mock.calls).toEqual([['blob:owned-2']]);
  instances[0].emit('end');
  expect(onEnd).toHaveBeenCalledTimes(1);
  current.dispose();
  expect(URL.revokeObjectURL.mock.calls).toEqual([
    ['blob:owned-2'],
    ['blob:owned-1'],
  ]);
});

test('abort during pending load releases that preparation and late load/play events stay inactive', async () => {
  const { audio, instances, URL } = boundary({ load: () => {} });
  const controller = new AbortController();
  const onPlay = jest.fn();
  const pending = audio.prepare(bytes, { signal: controller.signal, onPlay });
  const lateLoad = instances[0].events.load;
  const latePlay = instances[0].events.play;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  lateLoad();
  latePlay();
  expect(onPlay).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL.mock.calls).toEqual([['blob:owned-1']]);
});

test('abort after preparation leaves the installed handle live until its owner disposes it', async () => {
  const { audio, URL } = boundary();
  const controller = new AbortController();
  const onPlay = jest.fn();
  const handle = await audio.prepare(bytes, {
    signal: controller.signal,
    onPlay,
  });
  controller.abort();
  handle.play();
  expect(onPlay).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  handle.dispose();
});

test('media failure during pending device selection rejects and releases without waiting for the device', async () => {
  const { audio, instances, URL } = boundary({
    sink: () => new Promise(() => {}),
  });
  const pending = audio.prepare(bytes);
  await Promise.resolve();
  instances[0].emit('loaderror', 1, 4);
  await expect(pending).rejects.toMatchObject({ code: 4 });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
});
