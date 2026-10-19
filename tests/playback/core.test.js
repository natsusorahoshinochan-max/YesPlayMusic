import { createPlayback } from '@/playback';

const track = id => ({
  id,
  name: `Song ${id}`,
  ar: [{ name: 'Artist' }],
  al: { name: 'Album' },
  dt: 180000,
  no: 1,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup(overrides = {}) {
  const handles = [];
  const events = [];
  const feedback = [];
  const audio = {
    prepare: jest.fn(async (resource, options) => {
      let position = options.position || 0;
      const handle = {
        resource,
        options,
        play: jest.fn(() => options.onPlay()),
        pause: jest.fn(() => options.onPause()),
        seek: jest.fn(value => {
          position = value;
        }),
        position: () => position,
        setVolume: jest.fn(),
        applyOutputDevice: jest.fn(),
        dispose: jest.fn(),
      };
      handles.push(handle);
      return handle;
    }),
  };
  const playback = createPlayback({
    getTrack: async id => track(id),
    resources: {
      resolve: async t => ({
        kind: 'url',
        url: `https://audio/${t.id}`,
        sourceInfo: { provider: 'netease' },
      }),
      prefetch: jest.fn(async () => {}),
    },
    audio,
    onPlaybackEvent: event => events.push(event),
    onFeedback: event => feedback.push(event),
    setInterval: () => 1,
    clearInterval() {},
    ...overrides,
  });
  return { playback, handles, events, feedback, audio };
}

test('existing tracks play through audio handoff and ordinary next/previous/ended share queue order', async () => {
  const { playback, handles, events } = setup();
  const ids = [1, 2, 3];
  expect(
    await playback.playTracks(ids, { source: { type: 'playlist', id: 9 } })
  ).toEqual({ status: 'completed' });
  ids.push(4);
  expect(playback.state.currentTrackID).toBe(1);
  expect(playback.state.playing).toBe(true);
  expect(playback.upcoming(5)).toEqual([
    { trackId: 2, group: 'main', index: 1 },
    { trackId: 3, group: 'main', index: 2 },
  ]);
  await playback.next();
  expect(playback.state.currentTrackID).toBe(2);
  expect(handles[0].dispose).toHaveBeenCalledTimes(1);
  await playback.previous();
  expect(playback.state.currentTrackID).toBe(1);
  handles[2].options.onEnd();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(playback.state.currentTrackID).toBe(2);
  expect(events.map(event => event.type)).toContain('ended');
  playback.dispose();
});

test('the latest same-track selection owns metadata, resources, preparation and old failures', async () => {
  const metadata = [deferred(), deferred()];
  const { playback, feedback } = setup({
    getTrack: jest
      .fn()
      .mockImplementationOnce(() => metadata[0].promise)
      .mockImplementationOnce(() => metadata[1].promise),
  });
  const old = playback.playTracks([1], { source: { id: 10 } });
  await Promise.resolve();
  const latest = playback.playTracks([1], { source: { id: 20 } });
  await Promise.resolve();
  metadata[1].resolve(track(1));
  expect(await latest).toEqual({ status: 'completed' });
  metadata[0].reject(new Error('old failure'));
  expect(await old).toEqual({ status: 'superseded' });
  expect(playback.state.playlistSource.id).toBe(20);
  expect(feedback).toEqual([]);
});

test('a superseded preparation releases only its own handle and stale audio callbacks stay silent', async () => {
  const oldPreparation = deferred();
  const { playback, audio, handles, events } = setup();
  const normalPrepare = audio.prepare.getMockImplementation();
  let oldOptions;
  audio.prepare.mockImplementationOnce((resource, options) => {
    oldOptions = options;
    return oldPreparation.promise;
  });
  const old = playback.playTracks([1]);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const latest = playback.playTracks([2]);
  await latest;
  const oldHandle = await normalPrepare({}, oldOptions);
  oldPreparation.resolve(oldHandle);
  expect(await old).toEqual({ status: 'superseded' });
  expect(oldHandle.dispose).toHaveBeenCalledTimes(1);
  const count = events.length;
  oldOptions.onPlay();
  oldOptions.onEnd();
  oldOptions.onError({ code: 4 });
  expect(events).toHaveLength(count);
  expect(playback.state.currentTrackID).toBe(2);
  expect(handles[0].dispose).not.toHaveBeenCalled();
});

test('replacement delivers the old source and instantaneous position and natural end shares its recording claim', async () => {
  const records = [];
  const { playback, handles } = setup({
    onPlaybackEvent: event => {
      records.push({ ...event, claimed: event.recordOnce() });
    },
  });
  await playback.playTracks([1, 2], { source: { type: 'playlist', id: 10 } });
  playback.seek(12.8);
  await playback.playTracks([2, 3], { source: { type: 'album', id: 20 } });
  const replaced = records.find(event => event.type === 'before-replace');
  expect(replaced).toMatchObject({
    track: { id: 1 },
    source: { id: 10 },
    position: 12.8,
    claimed: true,
  });
  expect(replaced.recordOnce()).toBe(false);
  handles[1].options.onEnd();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const end = records.find(event => event.type === 'ended');
  const afterEnd = records.filter(event => event.type === 'before-replace')[1];
  expect(end).toMatchObject({
    track: { id: 2 },
    position: 180,
    completed: true,
    claimed: true,
  });
  expect(afterEnd).toMatchObject({
    instanceId: end.instanceId,
    claimed: false,
  });
});

test('public state is detached and reactive while transport, seek, volume and mute use the current audio', async () => {
  const { playback, handles, events } = setup();
  await playback.playTracks([1, 2]);
  const snapshot = playback.state;
  expect(Object.isFrozen(snapshot.currentTrack.ar)).toBe(true);
  playback.play();
  expect(events.filter(event => event.type === 'played')).toHaveLength(1);
  playback.pause();
  playback.play();
  expect(events.filter(event => event.type === 'played')).toHaveLength(2);
  playback.seek(20.2);
  expect(playback.position()).toBe(20.2);
  expect(playback.state.progress).toBe(20.2);
  playback.setVolume(0.4);
  playback.toggleMute();
  expect(playback.state.volume).toBe(0);
  playback.toggleMute();
  expect(playback.state.volume).toBe(0.4);
  expect(snapshot.volume).toBe(1);
  expect(handles[0].setVolume).toHaveBeenLastCalledWith(0.4);
  playback.dispose();
  playback.dispose();
  expect(handles[0].dispose).toHaveBeenCalledTimes(1);
});

test('unsupported preparation skips within the same operation and feedback remains at one application outlet', async () => {
  const { playback, audio, feedback, events } = setup();
  audio.prepare.mockRejectedValueOnce(
    Object.assign(new Error('unsupported'), { code: 4 })
  );
  expect(await playback.playTracks([1, 2, 3])).toEqual({
    status: 'unavailable',
    reason: 'unsupported-format',
  });
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.playing).toBe(true);
  expect(feedback).toHaveLength(1);
  expect(events.filter(event => event.type === 'played')).toHaveLength(1);
});

test('no source advances automatically while request rejection keeps the selected target and reports failure', async () => {
  const resolve = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ kind: 'url', url: 'ok' });
  const { playback, feedback } = setup({
    resources: { resolve, prefetch: async () => {} },
  });
  expect(await playback.playTracks([1, 2])).toEqual({
    status: 'unavailable',
    reason: 'no-source',
  });
  expect(playback.state.currentTrackID).toBe(2);
  expect(feedback.map(event => event.status)).toEqual(['unavailable']);
  resolve.mockRejectedValueOnce(new Error('network'));
  expect((await playback.playTracks([3, 4])).status).toBe('failed');
  expect(playback.state.currentTrackID).toBe(3);
  expect(feedback.map(event => event.status)).toEqual([
    'unavailable',
    'failed',
  ]);
});

test('dispose aborts a pending audio preparation and an eventual stale handle releases itself', async () => {
  const pending = deferred();
  const { playback, audio } = setup();
  let signal;
  const handle = { dispose: jest.fn() };
  audio.prepare.mockImplementationOnce((resource, options) => {
    signal = options.signal;
    return pending.promise;
  });
  const selection = playback.playTracks([1]);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  playback.dispose();
  expect(signal.aborted).toBe(true);
  pending.resolve(handle);
  expect(await selection).toEqual({ status: 'superseded' });
  expect(handle.dispose).toHaveBeenCalledTimes(1);
});

test('audio re-resolution keeps its operation and cannot recover over a newer external selection', async () => {
  const retry = deferred();
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({ kind: 'url', url: 'one' })
    .mockImplementationOnce(() => retry.promise)
    .mockResolvedValue({ kind: 'url', url: 'two' });
  const { playback, handles, feedback } = setup({
    resources: { resolve, prefetch: async () => {} },
  });
  await playback.playTracks([1]);
  playback.seek(14);
  handles[0].options.onError({ code: 2 });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await playback.playTracks([2]);
  retry.reject(new Error('late retry failure'));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.playing).toBe(true);
  expect(feedback).toEqual([]);
});

test('feedback receiver failure cannot change a failed result or steal the playing resource', async () => {
  const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({ kind: 'url', url: 'one' })
    .mockRejectedValue(new Error('network'));
  const { playback, handles } = setup({
    resources: { resolve, prefetch: async () => {} },
    onFeedback() {
      throw new Error('outlet failed');
    },
  });
  await playback.playTracks([1]);
  expect((await playback.playTracks([2])).status).toBe('failed');
  expect(handles[0].dispose).not.toHaveBeenCalled();
  playback.dispose();
  expect(handles[0].dispose).toHaveBeenCalledTimes(1);
  debug.mockRestore();
});

test('manual navigation at a queue boundary pauses and the retained current audio can resume', async () => {
  const { playback, events } = setup();
  await playback.playTracks([1]);
  expect(await playback.next()).toEqual({
    status: 'unavailable',
    reason: 'queue-ended',
  });
  expect(playback.state.playing).toBe(false);
  playback.play();
  expect(playback.state.playing).toBe(true);
  expect(events.filter(event => event.type === 'played')).toHaveLength(2);
  await playback.previous();
  expect(playback.state.playing).toBe(false);
  playback.toggle();
  expect(playback.state.playing).toBe(true);
});

test('progress samples update reactive progress without semantic outputs and old audio cannot sample into a new target', async () => {
  let tick;
  const onStateChange = jest.fn();
  const onProgress = jest.fn();
  const loading = deferred();
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({ kind: 'url', url: 'one' })
    .mockImplementationOnce(() => loading.promise);
  const { playback, handles } = setup({
    resources: { resolve, prefetch: async () => {} },
    setInterval: callback => {
      tick = callback;
      return 1;
    },
    onStateChange,
    onProgress,
  });
  await playback.playTracks([1]);
  handles[0].seek(25);
  const count = onStateChange.mock.calls.length;
  tick();
  expect(playback.state.progress).toBe(25);
  expect(onStateChange).toHaveBeenCalledTimes(count);
  expect(onProgress).toHaveBeenLastCalledWith(25);
  const selection = playback.playTracks([2]);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  handles[0].seek(30);
  tick();
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.progress).toBe(0);
  expect(onProgress).toHaveBeenCalledTimes(1);
  loading.resolve({ kind: 'url', url: 'two' });
  await selection;
});
