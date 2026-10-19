import { createPlayback } from '@/playback';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(sourceLists, overrides = {}) {
  const feedback = [];
  const prepared = [];
  const playback = createPlayback({
    sourceLists,
    getTrack: async id => ({ id, name: `Track ${id}`, dt: 180000 }),
    resources: {
      resolve: async track => ({ kind: 'url', url: `/${track.id}.mp3` }),
    },
    audio: {
      async prepare(resource, options) {
        prepared.push(resource.url);
        return {
          play: options.onPlay,
          pause: options.onPause,
          position: () => 0,
          setVolume() {},
          seek() {},
          dispose() {},
          applyOutputDevice() {},
        };
      },
    },
    onFeedback: event => feedback.push(event),
    ...overrides,
  });
  return { playback, feedback, prepared };
}

test('playlist playback owns list loading, preserves fresh and selects the requested track', async () => {
  const options = [];
  const { playback } = fixture({
    playlist: async (id, value) => {
      options.push([id, value]);
      return [11, 12, 13];
    },
  });
  try {
    expect(
      await playback.playPlaylist(50, { fresh: true, startTrackId: 12 })
    ).toEqual({ status: 'completed' });
    expect(options).toEqual([[50, { fresh: true }]]);
    expect(playback.state.currentTrackID).toBe(12);
    expect(playback.state.playlistSource).toEqual({ type: 'playlist', id: 50 });
    expect(playback.upcoming()).toEqual([
      { trackId: 13, group: 'main', index: 2 },
    ]);
    expect(Object.isFrozen(playback.state.playlistSource)).toBe(true);
  } finally {
    playback.dispose();
  }
});

test('intelligence chooses an in-bounds seed, forwards fresh and plays the returned default first track', async () => {
  const calls = [];
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
  const { playback } = fixture({
    playlist: async (id, options) => {
      calls.push(['playlist', id, options]);
      return [11, 12];
    },
    intelligence: async (id, seed) => {
      calls.push(['intelligence', id, seed]);
      return [21, 22];
    },
  });
  try {
    expect(
      await playback.playIntelligencePlaylist(50, { fresh: true })
    ).toEqual({ status: 'completed' });
    expect(calls).toEqual([
      ['playlist', 50, { fresh: true }],
      ['intelligence', 50, 12],
    ]);
    expect(playback.state.currentTrackID).toBe(21);
    expect(playback.state.playlistSource).toEqual({ type: 'playlist', id: 50 });
  } finally {
    random.mockRestore();
    playback.dispose();
  }
});

test.each(['album', 'artist'])(
  '%s defaults to the source first track and honors an explicit start',
  async type => {
    const { playback } = fixture({ [type]: async () => [31, 32, 33] });
    const method = type === 'album' ? 'playAlbum' : 'playArtist';
    try {
      await playback[method](60);
      expect(playback.state.currentTrackID).toBe(31);
      expect(playback.state.playlistSource).toEqual({ type, id: 60 });
      await playback[method](60, { startTrackId: 32 });
      expect(playback.state.currentTrackID).toBe(32);
    } finally {
      playback.dispose();
    }
  }
);

test.each(['resolve', 'reject'])(
  'new source selection supersedes a pending playlist before its list %s',
  async finish => {
    const list = deferred();
    const { playback, feedback, prepared } = fixture({
      playlist: () => list.promise,
      album: async () => [41, 42],
    });
    try {
      const old = playback.playPlaylist(50);
      await flush();
      const latest = playback.playAlbum(60, { startTrackId: 42 });
      await latest;
      if (finish === 'resolve') list.resolve([11, 12]);
      else list.reject(new Error('late list failure'));
      expect(await old).toEqual({ status: 'superseded' });
      expect(playback.state.currentTrackID).toBe(42);
      expect(playback.state.playlistSource).toEqual({ type: 'album', id: 60 });
      expect(prepared).toEqual(['/42.mp3']);
      expect(feedback).toEqual([]);
    } finally {
      playback.dispose();
    }
  }
);

test('intelligence cannot request recommendations after its seed-list operation loses ownership', async () => {
  const list = deferred();
  const intelligence = jest.fn(async () => [21]);
  const { playback } = fixture({
    playlist: () => list.promise,
    intelligence,
    artist: async () => [41],
  });
  try {
    const old = playback.playIntelligencePlaylist(50);
    await flush();
    await playback.playArtist(60);
    list.resolve([11]);
    expect(await old).toEqual({ status: 'superseded' });
    expect(intelligence).not.toHaveBeenCalled();
    expect(playback.state.currentTrackID).toBe(41);
  } finally {
    playback.dispose();
  }
});

test('source invocation immediately retires previous audio events even before its list request starts', async () => {
  const pending = deferred();
  let events;
  const feedback = [];
  const playback = createPlayback({
    sourceLists: { playlist: () => pending.promise },
    getTrack: async id => ({ id, dt: 10000 }),
    resources: { resolve: async () => ({ kind: 'url', url: '/audio' }) },
    audio: {
      prepare: async (_, options) => {
        events = options;
        return {
          play: options.onPlay,
          pause: options.onPause,
          position: () => 0,
          seek() {},
          setVolume() {},
          dispose() {},
        };
      },
    },
    onFeedback: event => feedback.push(event),
  });
  try {
    await playback.playTracks([1, 2]);
    const selection = playback.playPlaylist(50);
    events.onError({ code: 4 });
    pending.resolve([11]);
    await selection;
    expect(playback.state.currentTrackID).toBe(11);
    expect(feedback).toEqual([]);
  } finally {
    playback.dispose();
  }
});

test('empty intelligence seed list ends without a recommendation request or audio preparation', async () => {
  const intelligence = jest.fn();
  const { playback, prepared, feedback } = fixture({
    playlist: async () => [],
    intelligence,
  });
  try {
    expect(await playback.playIntelligencePlaylist(50)).toEqual({
      status: 'unavailable',
      reason: 'empty-queue',
    });
    expect(intelligence).not.toHaveBeenCalled();
    expect(prepared).toEqual([]);
    expect(feedback).toMatchObject([
      { status: 'unavailable', reason: 'empty-queue' },
    ]);
  } finally {
    playback.dispose();
  }
});

test.each(['metadata', 'resource'])(
  'a source selection retains ownership while old %s fails late',
  async stage => {
    const pending = deferred();
    const { playback, feedback, prepared } = fixture(
      {
        playlist: async () => [11],
        artist: async () => [41],
      },
      {
        getTrack: async id =>
          id === 11 && stage === 'metadata'
            ? pending.promise
            : { id, dt: 10000 },
        resources: {
          resolve: async track =>
            track.id === 11 && stage === 'resource'
              ? pending.promise
              : { kind: 'url', url: `/${track.id}.mp3` },
        },
      }
    );
    try {
      const old = playback.playPlaylist(50);
      await flush();
      await playback.playArtist(60);
      pending.reject(new Error(`late ${stage}`));
      expect(await old).toEqual({ status: 'superseded' });
      expect(playback.state.currentTrackID).toBe(41);
      expect(prepared).toEqual(['/41.mp3']);
      expect(feedback).toEqual([]);
    } finally {
      playback.dispose();
    }
  }
);

test('a current source request failure reports once without starting audio', async () => {
  const error = new Error('offline');
  const { playback, feedback, prepared } = fixture({
    album: async () => {
      throw error;
    },
  });
  try {
    expect(await playback.playAlbum(60)).toEqual({
      status: 'failed',
      reason: error,
    });
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ status: 'failed', reason: error });
    expect(prepared).toEqual([]);
  } finally {
    playback.dispose();
  }
});
