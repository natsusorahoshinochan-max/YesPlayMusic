import { createPlayback } from '@/playback';

const track = id => ({
  id,
  name: `Track ${id}`,
  dt: 100000,
  ar: [{ name: 'Artist' }],
  al: { name: 'Album' },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup() {
  const outputs = { states: [], progress: [], feedback: [], events: [] };
  const handles = [];
  const getTrack = jest.fn(async id => track(id));
  const resolve = jest.fn(async value => ({
    kind: 'url',
    url: `https://audio/${value.id}`,
    sourceInfo: { from: 'netease' },
  }));
  const playlist = jest.fn(async () => [2, 3]);
  const loadFM = jest.fn(async () => [track(6), track(7)]);
  const prepare = jest.fn(async (descriptor, callbacks) => {
    let playing = false;
    let position = 12;
    const handle = {
      play: jest.fn(() => {
        playing = true;
        callbacks.onPlay();
      }),
      pause: jest.fn(() => {
        playing = false;
        callbacks.onPause();
      }),
      seek: jest.fn(value => {
        position = value;
      }),
      position: () => position,
      setVolume: jest.fn(),
      applyOutputDevice: jest.fn(async () => {}),
      dispose: jest.fn(() => {
        playing = false;
      }),
      callbacks,
      isPlaying: () => playing,
    };
    handles.push(handle);
    return handle;
  });
  const playback = createPlayback({
    getTrack,
    sourceLists: { playlist },
    resources: { resolve },
    audio: { prepare },
    personalFM: { load: loadFM },
    setInterval: () => 0,
    clearInterval: () => {},
    onStateChange: value => outputs.states.push(value),
    onProgress: value => outputs.progress.push(value),
    onFeedback: value => outputs.feedback.push(value),
    onPlaybackEvent: value => {
      const recorded =
        value.type === 'before-replace' || value.type === 'ended'
          ? value.recordOnce()
          : false;
      outputs.events.push({ ...value, recorded });
    },
  });
  return {
    playback,
    outputs,
    handles,
    getTrack,
    resolve,
    playlist,
    prepare,
    loadFM,
  };
}

describe('latest selection terminal failure contract (Spec #17)', () => {
  test.each(['playlist', 'getTrack', 'resolve', 'prepare'])(
    '%s failure releases installed audio and publishes stopped state',
    async boundary => {
      const f = setup();
      await f.playback.playTracks([1, 4]);
      const old = f.handles[0];
      const error = new Error(`${boundary} rejected`);
      f[boundary].mockRejectedValueOnce(error);
      const result = await (boundary === 'playlist'
        ? f.playback.playPlaylist(7)
        : f.playback.playTracks([2, 3]));
      expect(result).toEqual({ status: 'failed', reason: error });
      expect(old.dispose).toHaveBeenCalledTimes(1);
      expect(old.isPlaying()).toBe(false);
      expect(f.playback.state.playing).toBe(false);
      expect(f.playback.state.sourceInfo).toBeNull();
      expect(f.playback.state.progress).toBe(0);
      expect(f.playback.position()).toBe(0);
      expect(f.outputs.states.at(-1).playing).toBe(false);
      expect(f.outputs.progress.at(-1)).toBe(0);
      expect(f.outputs.feedback).toHaveLength(1);
      expect(f.outputs.feedback[0].status).toBe('failed');
      const finalReport = f.outputs.events.filter(
        e => e.type === 'before-replace'
      );
      expect(finalReport).toHaveLength(1);
      expect(finalReport[0]).toMatchObject({
        track: { id: 1 },
        position: 12,
        recorded: true,
      });
      const outputCounts = Object.values(f.outputs).map(items => items.length);
      old.callbacks.onPlay();
      old.callbacks.onPause();
      old.callbacks.onEnd();
      old.callbacks.onError({ code: 4 });
      f.playback.pause();
      f.playback.toggle();
      expect(Object.values(f.outputs).map(items => items.length)).toEqual(
        outputCounts
      );
      expect(f.playback.state.playing).toBe(false);
      await f.playback.playTracks([3, 4]);
      f.playback.pause();
      expect(f.playback.state.playing).toBe(false);
      f.playback.toggle();
      expect(f.playback.state.playing).toBe(true);
      f.playback.dispose();
    }
  );

  test.each(['playlist', 'getTrack', 'resolve', 'prepare'])(
    'superseded %s failure cannot release successful newer audio or publish feedback',
    async boundary => {
      const f = setup();
      await f.playback.playTracks([1, 4]);
      const late = deferred();
      const started = deferred();
      f[boundary].mockImplementationOnce(() => {
        started.resolve();
        return late.promise;
      });
      const pending =
        boundary === 'playlist'
          ? f.playback.playPlaylist(7)
          : f.playback.playTracks([2, 3]);
      await started.promise;
      await f.playback.playTracks([3, 4]);
      const active = f.handles.at(-1);
      const counts = Object.values(f.outputs).map(items => items.length);
      late.reject(new Error('late rejection'));
      expect(await pending).toEqual({ status: 'superseded' });
      expect(active.dispose).not.toHaveBeenCalled();
      expect(active.isPlaying()).toBe(true);
      expect(f.playback.state.currentTrackID).toBe(3);
      expect(f.playback.state.playing).toBe(true);
      expect(Object.values(f.outputs).map(items => items.length)).toEqual(
        counts
      );
      f.playback.dispose();
    }
  );

  test('new main queues retain next entries and playNow consumes their existing order', async () => {
    const f = setup();
    await f.playback.playTracks([1, 2]);
    f.playback.enqueueNext(9);
    f.playback.enqueueNext(8);
    await f.playback.playPlaylist(7);
    expect(f.playback.upcoming(3).map(row => row.trackId)).toEqual([9, 8, 3]);
    await f.playback.playTracks([4, 5]);
    expect(f.playback.upcoming(3).map(row => row.trackId)).toEqual([9, 8, 5]);
    await f.playback.enqueueNext(7, { playNow: true });
    expect(f.playback.state.currentTrackID).toBe(9);
    expect(f.playback.upcoming(3).map(row => row.trackId)).toEqual([8, 7, 5]);
    f.playback.clearNext();
    expect(f.playback.upcoming(3).map(row => row.trackId)).toEqual([5]);
    f.playback.dispose();
  });

  test('retryable preparation remains in the same operation until successful handoff', async () => {
    const f = setup();
    await f.playback.playTracks([1, 4]);
    const old = f.handles[0];
    f.prepare.mockRejectedValueOnce(
      Object.assign(new Error('retry'), { retryable: true })
    );
    expect(await f.playback.playTracks([2, 3])).toEqual({
      status: 'completed',
    });
    expect(f.playback.state.currentTrackID).toBe(2);
    expect(f.playback.state.playing).toBe(true);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(f.outputs.feedback).toHaveLength(0);
    expect(
      f.outputs.events.filter(e => e.type === 'before-replace')
    ).toHaveLength(1);
    f.playback.dispose();
  });

  test('terminal private FM request failure uses the same release and feedback contract', async () => {
    const f = setup();
    await f.playback.playTracks([1, 4]);
    f.loadFM.mockRejectedValueOnce(new Error('FM request rejected'));
    expect(await f.playback.playPersonalFM()).toEqual({
      status: 'failed',
      reason: 'fm-timeout',
    });
    expect(f.handles[0].dispose).toHaveBeenCalledTimes(1);
    expect(f.playback.state.playing).toBe(false);
    expect(f.playback.state.personalFMLoading).toBe(false);
    expect(f.outputs.feedback).toHaveLength(1);
    f.playback.dispose();
  });
});

describe('unavailable selection terminal contract (Spec #17)', () => {
  test.each([
    'missing-queued-track',
    'empty-main-queue',
    'all-sources-unavailable',
  ])(
    '%s releases the previous operation audio without adding failure feedback',
    async scenario => {
      const f = setup();
      await f.playback.playTracks([1, 4]);
      const old = f.handles[0];
      let result;
      if (scenario === 'missing-queued-track') {
        result = await f.playback.playQueuedTrack(99);
        expect(result).toEqual({
          status: 'unavailable',
          reason: 'missing-track',
        });
        expect(f.outputs.feedback).toHaveLength(0);
      } else if (scenario === 'empty-main-queue') {
        result = await f.playback.playTracks([]);
        expect(result).toEqual({
          status: 'unavailable',
          reason: 'empty-queue',
        });
        expect(f.outputs.feedback.map(event => event.reason)).toEqual([
          'empty-queue',
        ]);
      } else {
        f.playback.cycleRepeat();
        f.resolve.mockResolvedValue(null);
        result = await f.playback.playTracks([2, 3]);
        expect(result).toEqual({ status: 'unavailable', reason: 'no-source' });
        expect(f.outputs.feedback.map(event => event.reason)).toEqual([
          'no-source',
          'no-source',
        ]);
      }
      expect(old.dispose).toHaveBeenCalledTimes(1);
      expect(old.isPlaying()).toBe(false);
      expect(f.playback.state.playing).toBe(false);
      expect(f.playback.state.sourceInfo).toBeNull();
      expect(f.playback.position()).toBe(0);
      expect(f.outputs.progress.at(-1)).toBe(0);
      const counts = Object.values(f.outputs).map(items => items.length);
      old.callbacks.onPlay();
      old.callbacks.onPause();
      old.callbacks.onEnd();
      expect(Object.values(f.outputs).map(items => items.length)).toEqual(
        counts
      );
      f.playback.dispose();
    }
  );

  test('unavailable first source preserves the new operation audio after a successful skip', async () => {
    const f = setup();
    await f.playback.playTracks([1, 4]);
    f.resolve.mockResolvedValueOnce(null);
    expect(await f.playback.playTracks([2, 3])).toEqual({
      status: 'unavailable',
      reason: 'no-source',
    });
    const active = f.handles.at(-1);
    expect(f.playback.state.currentTrackID).toBe(3);
    expect(f.playback.state.playing).toBe(true);
    expect(active.dispose).not.toHaveBeenCalled();
    f.playback.pause();
    expect(f.playback.state.playing).toBe(false);
    f.playback.toggle();
    expect(f.playback.state.playing).toBe(true);
    f.playback.dispose();
  });
});
