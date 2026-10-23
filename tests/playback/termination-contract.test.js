import { createPlayback } from '../../src/playback';
import { createAudioAdapter } from '../../src/playback/audioAdapter';

const track = id => ({ id, name: `歌曲 ${id} 🎵`, dt: 60000 });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let turn = 0; turn < 100; turn++) await Promise.resolve();
};
const activePlayers = [];

function setup({
  resolve,
  getTrack,
  loadFM,
  sourceList,
  prepareError,
  constructorError,
} = {}) {
  const log = [];
  const howls = [];
  const requested = [];
  let sample;
  let urlId = 0;
  class TestBlob {
    constructor(parts) {
      this.trackId = parts[0][0];
    }
  }
  const urls = {
    createObjectURL(blob) {
      const url = `blob:${blob.trackId}:${++urlId}`;
      log.push(['create', url]);
      return url;
    },
    revokeObjectURL(url) {
      log.push(['revoke', url]);
    },
  };
  class TestHowl {
    constructor({ src }) {
      this.url = src[0];
      this.trackId = Number(this.url.split(':')[1]);
      const failure = constructorError?.(this.trackId);
      if (failure) throw failure;
      this.listeners = new Map();
      this.seconds = 0;
      this.unloaded = false;
      this.playCalls = 0;
      howls.push(this);
    }
    on(name, listener) {
      const listeners = this.listeners.get(name) || [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    off(name, listener) {
      this.listeners.set(
        name,
        (this.listeners.get(name) || []).filter(value => value !== listener)
      );
    }
    emit(name, ...args) {
      for (const listener of this.listeners.get(name) || []) listener(...args);
    }
    load() {
      const failure = prepareError?.(this.trackId);
      if (failure) this.emit('loaderror', null, failure);
      else this.emit('load');
    }
    play() {
      this.playCalls++;
      this.emit('play');
    }
    pause() {
      this.emit('pause');
    }
    seek(value) {
      if (value !== undefined) this.seconds = value;
      return this.seconds;
    }
    volume() {}
    unload() {
      this.unloaded = true;
      log.push(['unload', this.url]);
    }
    end() {
      this.seconds = 0;
      this.emit('end');
    }
    error(code) {
      this.emit('playerror', null, code);
    }
  }
  const descriptor = id => ({
    kind: 'bytes',
    bytes: [id],
    sourceInfo: { type: 'contract', id },
  });
  const feedback = jest.fn(value => log.push(['feedback', value.reason]));
  const records = jest.fn(value => {
    log.push(['record', value.type, value.track.id]);
  });
  const progress = jest.fn();
  const trackChanges = jest.fn();
  const resources = {
    resolve: jest.fn(async value => {
      requested.push(value.id);
      return resolve ? resolve(value, descriptor) : descriptor(value.id);
    }),
  };
  const playback = createPlayback({
    getTrack: getTrack || (async id => track(id)),
    sourceLists: {
      playlist: sourceList || (async () => []),
      album: sourceList || (async () => []),
      artist: sourceList || (async () => []),
    },
    personalFM: { load: loadFM || (async () => []), trash: async () => {} },
    resources,
    audio: createAudioAdapter({ Howl: TestHowl, URL: urls, Blob: TestBlob }),
    delay: async () => {},
    onFeedback: feedback,
    onPlaybackEvent: records,
    onProgress: progress,
    onTrackChange: trackChanges,
    observe: value => value,
    setInterval: callback => {
      sample = callback;
      return 1;
    },
    clearInterval: () => {},
  });
  activePlayers.push(playback);
  return {
    playback,
    howls,
    requested,
    resources,
    feedback,
    records,
    progress,
    trackChanges,
    log,
    sample: () => sample(),
    descriptor,
  };
}

function expectStopped(fixture, visibleId) {
  const { playback, howls, progress, trackChanges } = fixture;
  expect(playback.state).toMatchObject({
    playing: false,
    progress: 0,
    sourceInfo: null,
    currentTrack: { id: visibleId },
  });
  expect(playback.position()).toBe(0);
  expect(howls.every(value => value.unloaded)).toBe(true);
  expect(progress).toHaveBeenLastCalledWith(0);
  expect(trackChanges).toHaveBeenLastCalledWith(null);
}

afterEach(() => {
  activePlayers.splice(0).forEach(playback => playback.dispose());
});

describe('Playback termination contract', () => {
  test.each(['tracks', 'playlist', 'stale main row', 'stale next row'])(
    '%s without a target releases old audio and preserves the visible song',
    async selection => {
      const fixture = setup();
      const { playback, log, howls, records } = fixture;
      await playback.playTracks([1, 2]);
      playback.seek(12.9);
      let result;
      if (selection === 'tracks') result = await playback.playTracks([]);
      else if (selection === 'playlist')
        result = await playback.playPlaylist(9);
      else if (selection === 'stale main row') {
        const row = playback.upcoming(1)[0];
        await playback.playTracks([1, 3]);
        playback.seek(12.9);
        result = await playback.playQueuedTrack(row.trackId, row);
      } else {
        playback.enqueueNext(2);
        const row = playback.upcoming(1)[0];
        playback.clearNext();
        result = await playback.playQueuedTrack(row.trackId, row);
      }
      expect(result.status).toBe('unavailable');
      expectStopped(fixture, 1);
      const last = howls[howls.length - 1];
      const unload = log.findIndex(
        entry => entry[0] === 'unload' && entry[1] === last.url
      );
      const revoke = log.findIndex(
        entry => entry[0] === 'revoke' && entry[1] === last.url
      );
      expect(unload).toBeGreaterThan(-1);
      expect(revoke).toBeGreaterThan(unload);
      expect(
        records.mock.calls.filter(([event]) => event.type === 'before-replace')
      ).toHaveLength(howls.length);
    }
  );

  test.each(['list', 'metadata', 'source', 'preparation'])(
    'latest %s failure reports the old instance once before release and feedback',
    async stage => {
      const failure = new Error(`${stage} failed`);
      const fixture = setup({
        sourceList: async () => {
          throw failure;
        },
        getTrack: async id => {
          if (id === 2 && stage === 'metadata') throw failure;
          return track(id);
        },
        resolve: (value, descriptor) => {
          if (value.id === 2 && stage === 'source') throw failure;
          return descriptor(value.id);
        },
        constructorError: id =>
          id === 2 && stage === 'preparation' ? failure : null,
      });
      await fixture.playback.playTracks([1]);
      fixture.playback.seek(9.75);
      const result =
        stage === 'list'
          ? await fixture.playback.playPlaylist(99)
          : await fixture.playback.playTracks([2]);
      expect(result.status).toBe('failed');
      const visibleId = stage === 'list' || stage === 'metadata' ? 1 : 2;
      expectStopped(fixture, visibleId);
      const finals = fixture.records.mock.calls
        .map(([event]) => event)
        .filter(event => event.type !== 'played');
      expect(finals).toHaveLength(1);
      expect(finals[0]).toMatchObject({
        track: { id: 1 },
        position: 9,
        durationSeconds: 60,
      });
      const oldUrl = fixture.howls[0].url;
      const finalRecord = fixture.log.findIndex(
        entry => entry[0] === 'record' && entry[1] === 'before-replace'
      );
      const unload = fixture.log.findIndex(
        entry => entry[0] === 'unload' && entry[1] === oldUrl
      );
      const revoke = fixture.log.findIndex(
        entry => entry[0] === 'revoke' && entry[1] === oldUrl
      );
      expect(finalRecord).toBeGreaterThan(-1);
      expect(finalRecord).toBeLessThan(unload);
      expect(unload).toBeLessThan(revoke);
      expect(revoke).toBeLessThan(
        fixture.log.findIndex(entry => entry[0] === 'feedback')
      );
    }
  );

  test.each(['off', 'on', 'one'])(
    'natural end with repeat %s exhausts sources, then Play retries the visible song',
    async mode => {
      let initial = true;
      let retryId;
      const fixture = setup({
        resolve: (value, descriptor) => {
          if (initial && value.id === 1) {
            initial = false;
            return descriptor(1);
          }
          return value.id === retryId ? descriptor(value.id) : null;
        },
      });
      const { playback, howls, requested, records } = fixture;
      playback.setRepeatMode(mode);
      await playback.playTracks([1, 2, 3]);
      howls[0].end();
      await settle();
      expect(requested).toEqual(
        mode === 'on' ? [1, 2, 3, 1] : mode === 'one' ? [1, 1, 2, 3] : [1, 2, 3]
      );
      retryId = requested[requested.length - 1];
      expectStopped(fixture, retryId);
      expect(records.mock.calls.map(([event]) => event.type)).toEqual([
        'played',
        'ended',
      ]);
      const beforeRetry = requested.length;
      await playback.play();
      await settle();
      expect(requested.slice(beforeRetry)).toEqual([retryId]);
      expect(playback.state).toMatchObject({
        currentTrack: { id: retryId },
        playing: true,
      });
      expect(howls[0].playCalls).toBe(1);
      expect(howls[howls.length - 1].trackId).toBe(retryId);
    }
  );

  test('retry of an unavailable visible song continues the existing skip order', async () => {
    let initial = true;
    let retry = false;
    const fixture = setup({
      resolve: (value, descriptor) => {
        if (initial && value.id === 1) {
          initial = false;
          return descriptor(1);
        }
        return retry && value.id === 2 ? descriptor(2) : null;
      },
    });
    fixture.playback.setRepeatMode('on');
    await fixture.playback.playTracks([1, 2, 3]);
    fixture.howls[0].end();
    await settle();
    expectStopped(fixture, 1);
    retry = true;
    const before = fixture.requested.length;
    await fixture.playback.play();
    await settle();
    expect(fixture.requested.slice(before)).toEqual([1, 2]);
    expect(fixture.playback.state).toMatchObject({
      currentTrack: { id: 2 },
      playing: true,
    });
  });

  test('successful no-source skip remains playing even when the request returns unavailable', async () => {
    const fixture = setup({
      resolve: (value, descriptor) =>
        value.id === 2 ? null : descriptor(value.id),
    });
    await fixture.playback.playTracks([1]);
    const result = await fixture.playback.playTracks([2, 3]);
    expect(result).toEqual({ status: 'unavailable', reason: 'no-source' });
    expect(fixture.playback.state).toMatchObject({
      currentTrack: { id: 3 },
      playing: true,
    });
    expect(fixture.howls[fixture.howls.length - 1].unloaded).toBe(false);
  });

  test('ordinary natural tail can replay its current song without being treated as source exhaustion', async () => {
    const fixture = setup();
    await fixture.playback.playTracks([1]);
    fixture.playback.seek(17.5);
    expect(fixture.playback.state.progress).toBe(17.5);
    fixture.howls[0].end();
    await settle();
    expect(fixture.playback.state.currentTrack.id).toBe(1);
    expect(fixture.playback.state.playing).toBe(false);
    await fixture.playback.play();
    await settle();
    expect(fixture.playback.state).toMatchObject({
      currentTrack: { id: 1 },
      playing: true,
      progress: 0,
    });
    expect(fixture.playback.position()).toBe(0);
    expect(fixture.progress).toHaveBeenLastCalledWith(0);
    fixture.howls[fixture.howls.length - 1].end();
    await settle();
    await fixture.playback.playTracks([2]);
    const ended = fixture.records.mock.calls
      .map(([event]) => event)
      .filter(event => event.type === 'ended');
    expect(ended).toHaveLength(2);
    expect(
      ended.every(event => event.position === 60 && event.track.id === 1)
    ).toBe(true);
    expect(
      fixture.records.mock.calls.filter(
        ([event]) => event.type === 'before-replace'
      )
    ).toHaveLength(0);
  });

  test('manual next at the tail pauses and preserves its position for Play', async () => {
    const fixture = setup();
    await fixture.playback.playTracks([1]);
    fixture.playback.seek(17.5);
    expect(await fixture.playback.next()).toEqual({
      status: 'unavailable',
      reason: 'queue-ended',
    });
    expect(fixture.playback.state).toMatchObject({
      playing: false,
      progress: 17.5,
    });
    expect(fixture.playback.position()).toBe(17.5);
    expect(fixture.howls[0].unloaded).toBe(false);
    fixture.playback.play();
    expect(fixture.playback.state.playing).toBe(true);
    expect(fixture.playback.position()).toBe(17.5);
  });

  test('seeking after a natural tail resumes from the selected position and records each playback once', async () => {
    const fixture = setup();
    await fixture.playback.playTracks([1]);
    fixture.howls[0].end();
    await settle();
    expect(fixture.records.mock.calls.map(([event]) => event.type)).toEqual([
      'played',
      'ended',
    ]);
    fixture.playback.seek(25);
    expect(fixture.playback.position()).toBe(25);
    await fixture.playback.play();
    expect(fixture.playback.state).toMatchObject({
      currentTrack: { id: 1 },
      playing: true,
      progress: 25,
    });
    expect(fixture.playback.position()).toBe(25);
    fixture.howls[0].end();
    await settle();
    await fixture.playback.playTracks([2]);
    const finalRecords = fixture.records.mock.calls
      .map(([event]) => event)
      .filter(event => event.type !== 'played');
    expect(finalRecords).toHaveLength(2);
    for (const event of finalRecords) {
      expect(event).toMatchObject({
        type: 'ended',
        track: { id: 1 },
        position: 60,
        durationSeconds: 60,
      });
    }
  });

  test.each([3, 4])(
    'runtime media error %s cannot retry the failed current song during exhaustion',
    async code => {
      const fixture = setup({
        resolve: (value, descriptor) => (value.id === 1 ? descriptor(1) : null),
      });
      fixture.playback.setRepeatMode('on');
      await fixture.playback.playTracks([1, 2]);
      fixture.playback.seek(14);
      fixture.howls[0].error(code);
      await settle();
      expect(fixture.requested).toEqual([1, 2]);
      expectStopped(fixture, 2);
      const finals = fixture.records.mock.calls
        .map(([event]) => event)
        .filter(event => event.type !== 'played');
      expect(finals).toHaveLength(1);
      expect(finals[0]).toMatchObject({ track: { id: 1 }, position: 14 });
    }
  );

  test.each(['empty', 'same', 'cycle'])(
    'FM %s candidates terminate and release ended audio',
    async shape => {
      let loads = 0;
      const fixture = setup({
        loadFM: async () => {
          loads++;
          if (loads === 1) return [track(1), track(2)];
          if (shape === 'empty') return [];
          if (shape === 'same') return [track(2)];
          return [track(loads % 2 ? 2 : 1)];
        },
        resolve: (value, descriptor) =>
          value.id === 1 && loads === 1 ? descriptor(1) : null,
      });
      await fixture.playback.playPersonalFM();
      fixture.howls[0].end();
      await settle();
      expectStopped(fixture, fixture.requested[fixture.requested.length - 1]);
      expect(fixture.requested.length).toBeLessThanOrEqual(3);
      expect(fixture.records.mock.calls.map(([event]) => event.type)).toEqual([
        'played',
        'ended',
      ]);
    }
  );

  test.each([
    'no source',
    'source rejection',
    'metadata rejection',
    'list rejection',
  ])(
    'late %s from a superseded selection cannot release newer audio',
    async response => {
      const pending = deferred();
      const fixture = setup({
        sourceList: () => pending.promise,
        getTrack: id =>
          id === 2 && response === 'metadata rejection'
            ? pending.promise
            : Promise.resolve(track(id)),
        resolve: (value, descriptor) =>
          value.id === 2 && response !== 'metadata rejection'
            ? pending.promise
            : descriptor(value.id),
      });
      await fixture.playback.playTracks([1]);
      const old =
        response === 'list rejection'
          ? fixture.playback.playPlaylist(9)
          : fixture.playback.playTracks([2]);
      await settle();
      await fixture.playback.playTracks([3]);
      if (response === 'no source') pending.resolve(null);
      else pending.reject(new Error('late failure'));
      expect(await old).toEqual({ status: 'superseded' });
      expect(fixture.playback.state).toMatchObject({
        currentTrack: { id: 3 },
        playing: true,
        sourceInfo: { id: 3 },
      });
      expect(fixture.howls[fixture.howls.length - 1].unloaded).toBe(false);
      expect(fixture.feedback).not.toHaveBeenCalled();
      expect(fixture.requested).not.toContain(4);
    }
  );

  test.each([3, 4])(
    'preparation media error %s skips once and releases all failed resources on exhaustion',
    async code => {
      const fixture = setup({
        prepareError: id => (id === 2 ? code : null),
        resolve: (value, descriptor) =>
          value.id === 3 ? null : descriptor(value.id),
      });
      await fixture.playback.playTracks([1]);
      fixture.playback.seek(11);
      const result = await fixture.playback.playTracks([2, 3]);
      expect(result.status).toBe('unavailable');
      expect(fixture.requested).toEqual([1, 2, 3]);
      expectStopped(fixture, 3);
      for (const howl of fixture.howls) {
        const unload = fixture.log.findIndex(
          entry => entry[0] === 'unload' && entry[1] === howl.url
        );
        const revokes = fixture.log.filter(
          entry => entry[0] === 'revoke' && entry[1] === howl.url
        );
        expect(unload).toBeGreaterThan(-1);
        expect(revokes).toHaveLength(1);
        expect(fixture.log.indexOf(revokes[0])).toBeGreaterThan(unload);
      }
    }
  );

  test.each([null, undefined, {}])(
    'missing track metadata %p terminates without publishing a nonexistent song',
    async metadata => {
      const fixture = setup({
        getTrack: async id => (id === 1 ? track(1) : metadata),
      });
      await fixture.playback.playTracks([1]);
      const result = await fixture.playback.playTracks([2]);
      expect(result.status).toBe('failed');
      expectStopped(fixture, 1);
      expect(fixture.requested).toEqual([1]);
    }
  );

  test.each(['no source', 'rejection'])(
    'ordinary tail reuses playable audio even if its source would now return %s',
    async unavailable => {
      const fixture = setup();
      await fixture.playback.playTracks([1]);
      if (unavailable === 'no source')
        fixture.resources.resolve.mockResolvedValue(null);
      else fixture.resources.resolve.mockRejectedValue(new Error('offline'));
      for (let replay = 0; replay < 2; replay++) {
        fixture.howls[0].end();
        await settle();
        await fixture.playback.play();
        expect(fixture.playback.state.playing).toBe(true);
        expect(fixture.playback.position()).toBe(0);
      }
      expect(fixture.resources.resolve).toHaveBeenCalledTimes(1);
      expect(fixture.howls).toHaveLength(1);
      expect(fixture.howls[0].unloaded).toBe(false);
      const finals = fixture.records.mock.calls
        .map(([event]) => event)
        .filter(event => event.type === 'ended');
      expect(finals).toHaveLength(2);
      expect(finals.every(event => event.position === 60)).toBe(true);
    }
  );

  test('backward exhaustion leaves queued-next entries untouched and retries forward from the visible song', async () => {
    let initial = true;
    let retry = false;
    const fixture = setup({
      resolve: (value, descriptor) => {
        if (initial && value.id === 1) {
          initial = false;
          return descriptor(1);
        }
        return retry && [2, 3].includes(value.id) ? descriptor(value.id) : null;
      },
    });
    fixture.playback.setRepeatMode('on');
    await fixture.playback.playTracks([1, 2, 3]);
    fixture.playback.enqueueNext(8);
    fixture.playback.enqueueNext(9);
    await fixture.playback.previous();
    expect(fixture.requested).toEqual([1, 3, 2, 1]);
    expectStopped(fixture, 1);
    expect(fixture.playback.upcoming(2).map(row => row.trackId)).toEqual([
      8, 9,
    ]);
    retry = true;
    const before = fixture.requested.length;
    await fixture.playback.play();
    await settle();
    expect(fixture.requested.slice(before)).toEqual([1, 8, 9, 2]);
    expect(fixture.playback.state).toMatchObject({
      currentTrack: { id: 2 },
      playing: true,
    });
  });

  test('an empty initial FM response releases ordinary playback', async () => {
    const fixture = setup();
    await fixture.playback.playTracks([1]);
    const result = await fixture.playback.playPersonalFM();
    expect(result).toEqual({ status: 'unavailable', reason: 'fm-empty' });
    expectStopped(fixture, 1);
  });

  test('an FM same-song response ends the selection even before a source lookup', async () => {
    let loads = 0;
    const fixture = setup({
      loadFM: async () => (++loads === 1 ? [track(1), track(2)] : [track(2)]),
    });
    await fixture.playback.playPersonalFM();
    await fixture.playback.next();
    await settle();
    expect(fixture.playback.state.currentTrack.id).toBe(2);
    const result = await fixture.playback.next();
    expect(result).toEqual({ status: 'unavailable', reason: 'fm-same-track' });
    expectStopped(fixture, 2);
    expect(fixture.requested).toEqual([1, 2]);
  });

  test('a selected FM row that became stale ends current playback', async () => {
    let loads = 0;
    const fixture = setup({
      loadFM: async () => (++loads === 1 ? [track(1), track(2)] : [track(3)]),
    });
    await fixture.playback.playPersonalFM();
    const row = fixture.playback.upcoming(1)[0];
    expect(await fixture.playback.playQueuedTrack(row.trackId, row)).toEqual({
      status: 'completed',
    });
    await settle();
    expect(await fixture.playback.playQueuedTrack(row.trackId, row)).toEqual({
      status: 'unavailable',
      reason: 'missing-track',
    });
    expectStopped(fixture, 2);
  });

  test('temporary runtime media errors retry the current song at the same position', async () => {
    const fixture = setup();
    await fixture.playback.playTracks([1]);
    fixture.playback.seek(13);
    fixture.howls[0].error(2);
    await settle();
    expect(fixture.requested).toEqual([1, 1]);
    expect(fixture.playback.state).toMatchObject({
      currentTrack: { id: 1 },
      playing: true,
      progress: 13,
    });
    expect(fixture.playback.position()).toBe(13);
    expect(fixture.howls[0].unloaded).toBe(true);
  });

  test.each(['main', 'next'])(
    'a valid %s row switches audio without releasing the new instance',
    async group => {
      const fixture = setup();
      await fixture.playback.playTracks([1, 2]);
      if (group === 'next') fixture.playback.enqueueNext(2);
      const row = fixture.playback.upcoming(1)[0];
      expect(await fixture.playback.playQueuedTrack(row.trackId, row)).toEqual({
        status: 'completed',
      });
      expect(fixture.playback.state).toMatchObject({
        currentTrack: { id: 2 },
        playing: true,
      });
      expect(fixture.howls[0].unloaded).toBe(true);
    }
  );

  test.each([3, 4])(
    'consecutive runtime media errors %s terminate a looping queue after each candidate fails once',
    async code => {
      const fixture = setup();
      fixture.playback.setRepeatMode('on');
      await fixture.playback.playTracks([1, 2]);
      fixture.howls[0].error(code);
      await settle();
      expect(fixture.playback.state).toMatchObject({
        currentTrack: { id: 2 },
        playing: true,
      });
      fixture.howls[1].error(code);
      await settle();
      expect(fixture.requested).toEqual([1, 2]);
      expectStopped(fixture, 2);
    }
  );

  test.each([3, 4])(
    'runtime media errors %s keep the previous operation direction until exhaustion',
    async code => {
      const fixture = setup();
      fixture.playback.setRepeatMode('on');
      await fixture.playback.playTracks([1, 2, 3], { startTrackId: 3 });
      await fixture.playback.previous();
      expect(fixture.playback.state.currentTrack.id).toBe(2);
      fixture.howls[fixture.howls.length - 1].error(code);
      await settle();
      expect(fixture.playback.state.currentTrack.id).toBe(1);
      fixture.howls[fixture.howls.length - 1].error(code);
      await settle();
      expect(fixture.playback.state.currentTrack.id).toBe(3);
      fixture.howls[fixture.howls.length - 1].error(code);
      await settle();
      expect(fixture.requested).toEqual([3, 2, 1, 3]);
      expectStopped(fixture, 3);
    }
  );
});
