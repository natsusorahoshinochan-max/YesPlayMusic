import { createPlayback } from '@/playback';
import { createAudioAdapter } from '@/playback/audioAdapter';
import { EventEmitter } from 'events';

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
function setup(audio) {
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
  const trash = jest.fn(async () => {});
  const playback = createPlayback({
    getTrack,
    sourceLists: { playlist },
    resources: { resolve },
    audio: audio || { prepare },
    personalFM: { load: loadFM, trash },
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
    trash,
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
      expect(f.playback.state.currentTrack.id).toBe(3);
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
    expect(f.playback.state.currentTrack.id).toBe(9);
    expect(f.playback.upcoming(3).map(row => row.trackId)).toEqual([8, 7, 5]);
    f.playback.clearNext();
    expect(f.playback.upcoming(3).map(row => row.trackId)).toEqual([5]);
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
    expect(f.playback.state.currentTrack.id).toBe(3);
    expect(f.playback.state.playing).toBe(true);
    expect(active.dispose).not.toHaveBeenCalled();
    f.playback.pause();
    expect(f.playback.state.playing).toBe(false);
    f.playback.toggle();
    expect(f.playback.state.playing).toBe(true);
    f.playback.dispose();
  });
});

function mediaFixture() {
  const sounds = [];
  const loads = [];
  class Howl extends EventEmitter {
    constructor() {
      super();
      this.position = 0;
      this.unload = jest.fn();
      this._sounds = [];
      sounds.push(this);
    }
    load() {
      const failure = loads.shift();
      if (failure !== undefined) this.emit('loaderror', 0, failure);
      else this.emit('load');
    }
    play() {
      this.emit('play');
    }
    pause() {
      this.emit('pause');
    }
    seek(value) {
      if (value !== undefined) this.position = value;
      return this.position;
    }
    volume() {}
  }
  return { sounds, loads, audio: createAudioAdapter({ Howl }) };
}

describe('media failures through the production audio adapter', () => {
  test.each(['preparation', 'playing'])(
    '%s media network errors re-resolve the same song and retain position',
    async phase => {
      const media = mediaFixture();
      const f = setup(media.audio);
      await f.playback.playTracks([1, 2]);
      const old = media.sounds[0];
      if (phase === 'preparation') {
        media.loads.push(2);
        await f.playback.playTracks([3, 4]);
      } else {
        f.playback.seek(12);
        old.emit('playerror', 0, 2);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(f.playback.state.currentTrack.id).toBe(
        phase === 'preparation' ? 3 : 1
      );
      expect(f.playback.state.playing).toBe(true);
      expect(f.playback.position()).toBe(phase === 'preparation' ? 0 : 12);
      expect(old.unload).toHaveBeenCalledTimes(1);
      expect(f.resolve.mock.calls.map(([value]) => value.id)).toEqual(
        phase === 'preparation' ? [1, 3, 3] : [1, 1]
      );
      expect(f.outputs.feedback).toHaveLength(0);
      f.playback.dispose();
    }
  );
  test.each([3, 4])(
    'media code %s skips through the same policy before and after preparation',
    async code => {
      for (const phase of ['preparation', 'playing']) {
        const media = mediaFixture();
        const f = setup(media.audio);
        if (phase === 'preparation') media.loads.push(code);
        await f.playback.playTracks([1, 2]);
        if (phase === 'playing') {
          media.sounds[0].emit('playerror', 0, code);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(f.playback.state.currentTrack.id).toBe(2);
        expect(f.playback.state.playing).toBe(true);
        expect(f.outputs.feedback.map(value => value.reason)).toEqual(
          code === 4 ? ['unsupported-format'] : []
        );
        f.playback.dispose();
      }
    }
  );
  test('output device rejection ends selection without media retry', async () => {
    const media = mediaFixture();
    const f = setup(media.audio);
    await f.playback.playTracks([1]);
    const failure = new DOMException(
      'Requested device was not found',
      'NotFoundError'
    );
    const original = media.audio.prepare;
    media.audio.prepare = (descriptor, options) => {
      const prepared = original(descriptor, options);
      media.sounds.at(-1)._sounds = [
        { _node: { setSinkId: () => Promise.reject(failure) } },
      ];
      return prepared;
    };
    expect(await f.playback.playTracks([2, 3])).toEqual({
      status: 'failed',
      reason: failure,
    });
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.playback.state.playing).toBe(false);
    f.playback.dispose();
  });
});

describe('personal FM reading and discard ownership', () => {
  test('FM end adopts a failed next read through the FM operation', async () => {
    const f = setup();
    f.loadFM.mockResolvedValueOnce([track(6)]).mockResolvedValueOnce([]);
    await f.playback.playPersonalFM();
    await new Promise(resolve => setTimeout(resolve, 0));
    f.loadFM.mockRejectedValueOnce(new Error('read failed'));
    f.handles[0].callbacks.onEnd();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.playback.state.playing).toBe(false);
    expect(f.playback.state.personalFMLoading).toBe(false);
    expect(f.handles[0].dispose).toHaveBeenCalledTimes(1);
    expect(f.outputs.feedback.map(value => value.reason)).toEqual([
      'fm-timeout',
    ]);
    f.playback.dispose();
  });
  test('trash failure reports failure while the handed-off FM song keeps playing', async () => {
    const f = setup();
    await f.playback.playPersonalFM();
    const failure = new Error('trash rejected');
    f.trash.mockRejectedValueOnce(failure);
    expect(await f.playback.discardFMTrack()).toEqual({
      status: 'failed',
      reason: failure,
    });
    expect(f.trash).toHaveBeenCalledWith(6);
    expect(f.playback.state.currentTrack.id).toBe(7);
    expect(f.playback.state.playing).toBe(true);
    expect(f.handles.at(-1).dispose).not.toHaveBeenCalled();
    expect(f.outputs.feedback.map(value => value.reason)).toEqual([failure]);
    f.playback.dispose();
  });
});
