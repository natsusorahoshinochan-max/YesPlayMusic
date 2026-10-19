import { EventEmitter } from 'events';
import { createPlayback } from '@/playback';
import { createPlaybackPlatform } from '@/application/playbackPlatform';

const track = {
  id: 7,
  name: 'Seven',
  dt: 90000,
  ar: [{ name: 'Artist' }],
  al: { name: 'Album', picUrl: '/cover' },
};
function setup(options = {}, playbackOptions = {}) {
  const ipc = new EventEmitter();
  ipc.send = jest.fn();
  const actions = {};
  const mediaSession = {
    setActionHandler: (name, callback) => {
      actions[name] = callback;
    },
    setPositionState: jest.fn(),
  };
  let position = 0;
  let platform;
  const playback = createPlayback({
    getTrack: async () => track,
    resources: {
      resolve: async () => ({
        kind: 'url',
        url: '/audio',
        sourceInfo: { from: 'netease' },
      }),
      prefetch: async () => {},
    },
    audio: {
      prepare: async (_, events) => ({
        play: events.onPlay,
        pause: events.onPause,
        seek: value => {
          position = value;
        },
        position: () => position,
        setVolume() {},
        dispose() {},
      }),
    },
    onStateChange: state => platform?.publish(state),
    onProgress: (value, detail) => platform?.progress(value, detail),
    ...playbackOptions,
  });
  platform = createPlaybackPlatform({
    playback,
    ipc,
    navigator: { mediaSession },
    window,
    document,
    MediaMetadata: class {
      constructor(value) {
        Object.assign(this, value);
      }
    },
    createTray: true,
    createMpris: true,
    ...options,
  });
  return { playback, platform, ipc, mediaSession, actions };
}

test('native and media controls change public playback and are removed on disposal', async () => {
  const { playback, platform, ipc, actions } = setup();
  await playback.playTracks([7], { type: 'playlist', id: 1 });
  actions.play();
  expect(playback.state.playing).toBe(true);
  actions.seekto({ seekTime: 23 });
  expect(playback.position()).toBe(23);
  ipc.emit('decreaseVolume');
  expect(playback.state.volume).toBe(0.9);
  ipc.emit('play');
  expect(playback.state.playing).toBe(false);
  platform.dispose();
  expect(actions.play).toBe(null);
  expect(ipc.listenerCount('play')).toBe(0);
  expect(ipc.listenerCount('setPosition')).toBe(0);
  playback.dispose();
});

test('metadata is published before audio resolution and final state includes favorites and title', async () => {
  let resolveSource;
  const { playback, platform, ipc, mediaSession } = setup();
  // The source boundary can be held while public metadata is already available.
  playback.dispose();
  platform.dispose();
  let output;
  const next = createPlayback({
    getTrack: async () => track,
    resources: {
      resolve: () =>
        new Promise(resolve => {
          resolveSource = resolve;
        }),
      prefetch: async () => {},
    },
    audio: {
      prepare: async (_, events) => ({
        play: events.onPlay,
        pause: events.onPause,
        position: () => 0,
        setVolume() {},
        dispose() {},
      }),
    },
    onStateChange: state => output?.publish(state, true),
  });
  output = createPlaybackPlatform({
    playback: next,
    ipc,
    navigator: { mediaSession },
    window,
    document,
    MediaMetadata: class {
      constructor(value) {
        Object.assign(this, value);
      }
    },
    createTray: true,
    createMpris: true,
  });
  const pending = next.playTracks([7], { type: 'playlist', id: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(mediaSession.metadata.title).toBe('Seven');
  expect(window.yesplaymusic.player.currentTrack.id).toBe(7);
  expect(window.yesplaymusic.player.playing).toBe(false);
  resolveSource({
    kind: 'url',
    url: '/audio',
    sourceInfo: { from: 'netease' },
  });
  await pending;
  expect(window.yesplaymusic.player.playing).toBe(true);
  expect(document.title).toBe('Seven · Artist - YesPlayMusic');
  expect(ipc.send).toHaveBeenCalledWith(
    'player',
    expect.objectContaining({ playing: true, likedCurrentTrack: true })
  );
  next.pause();
  expect(document.title).toBe('YesPlayMusic');
  output.dispose();
  next.dispose();
  expect(window.yesplaymusic.player).toBeUndefined();
});

test('OSD lyrics acknowledge only the current metadata request and release their single listener', async () => {
  const { playback, platform, ipc } = setup({
    settings: () => ({ enableOsdlyricsSupport: true }),
    getLyric: async id => ({ lrc: { lyric: `lyrics ${id}` } }),
  });
  const publish = id =>
    platform.publish({
      ...playback.state,
      currentTrackID: id,
      currentTrack: { ...track, id },
      durationSeconds: 90,
    });
  publish(7);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const first = ipc.send.mock.calls.find(
    ([channel]) => channel === 'sendLyrics'
  )[1];
  publish(8);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const second = ipc.send.mock.calls.filter(
    ([channel]) => channel === 'sendLyrics'
  )[1][1];
  ipc.emit('saveLyricFinished', {}, first.requestId);
  expect(
    ipc.send.mock.calls.filter(([channel]) => channel === 'metadata')
  ).toHaveLength(0);
  ipc.emit('saveLyricFinished', {}, second.requestId);
  expect(ipc.send).toHaveBeenCalledWith(
    'metadata',
    expect.objectContaining({ url: '/trackid/8' })
  );
  expect(ipc.listenerCount('saveLyricFinished')).toBe(1);
  platform.dispose();
  playback.dispose();
  expect(ipc.listenerCount('saveLyricFinished')).toBe(0);
});

test('keyboard media controls and progress outputs share Playback and stop after disposal', async () => {
  const { playback, platform, ipc, mediaSession } = setup({
    settings: () => ({ enableDiscordRichPresence: true }),
  });
  await playback.playTracks([7]);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'MediaPlayPause' })
  );
  expect(playback.state.playing).toBe(false);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'MediaPlayPause' })
  );
  playback.seek(28);
  platform.progress(28, { seeked: true });
  expect(ipc.send).toHaveBeenCalledWith('seeked', 28);
  expect(ipc.send).toHaveBeenCalledWith(
    'playDiscordPresence',
    expect.objectContaining({ dt: 62000 })
  );
  expect(mediaSession.setPositionState).toHaveBeenLastCalledWith({
    duration: 90,
    playbackRate: 1,
    position: 28,
  });
  expect(window.yesplaymusic.player.progress).toBe(28);
  platform.dispose();
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'MediaPlayPause' })
  );
  expect(playback.state.playing).toBe(true);
  playback.dispose();
});

test('disposing platform clears media metadata and ignores an outstanding lyric response', async () => {
  let resolveLyrics;
  const { playback, platform, ipc, mediaSession } = setup({
    settings: () => ({ enableOsdlyricsSupport: true }),
    getLyric: () =>
      new Promise(resolve => {
        resolveLyrics = resolve;
      }),
  });
  await playback.playTracks([7]);
  expect(mediaSession.metadata.title).toBe('Seven');
  platform.dispose();
  expect(mediaSession.metadata).toBe(null);
  const sent = ipc.send.mock.calls.length;
  resolveLyrics({ lrc: { lyric: 'late' } });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(ipc.send.mock.calls).toHaveLength(sent);
  playback.dispose();
});

test('new metadata publishes its own progress while the previous audio awaits replacement', async () => {
  let finishSource;
  let sample;
  const source = new Promise(resolve => {
    finishSource = resolve;
  });
  const { playback, platform, mediaSession, ipc } = setup(
    {},
    {
      getTrack: async id => ({
        ...track,
        id,
        name: id === 7 ? 'Seven' : 'Eight',
      }),
      resources: {
        resolve: current =>
          current.id === 7
            ? Promise.resolve({
                kind: 'url',
                url: '/seven',
                sourceInfo: { from: 'netease' },
              })
            : source,
      },
      setInterval: callback => {
        sample = callback;
        return 1;
      },
      clearInterval() {},
    }
  );
  await playback.playTracks([7]);
  playback.seek(37);
  expect(window.yesplaymusic.player.progress).toBe(37);
  expect(document.title).toBe('Seven · Artist - YesPlayMusic');
  const selection = playback.playTracks([8]);
  await Promise.resolve();
  await Promise.resolve();
  expect(window.yesplaymusic.player).toMatchObject({
    currentTrackID: 8,
    progress: 0,
  });
  expect(mediaSession.metadata.title).toBe('Eight');
  expect(document.title).toBe('Seven · Artist - YesPlayMusic');
  expect(ipc.send).not.toHaveBeenCalledWith(
    'playDiscordPresence',
    expect.objectContaining({ id: 8 })
  );
  expect(mediaSession.setPositionState).toHaveBeenLastCalledWith({
    duration: 90,
    playbackRate: 1,
    position: 0,
  });
  // The old audio is still live, but its operation no longer owns timer output.
  expect(playback.position()).toBe(37);
  sample();
  expect(window.yesplaymusic.player.progress).toBe(0);
  expect(mediaSession.setPositionState).toHaveBeenLastCalledWith({
    duration: 90,
    playbackRate: 1,
    position: 0,
  });
  playback.seek(38);
  expect(ipc.send).not.toHaveBeenCalledWith(
    'playDiscordPresence',
    expect.objectContaining({ id: 8 })
  );
  finishSource({ kind: 'url', url: '/eight', sourceInfo: { from: 'netease' } });
  await selection;
  expect(document.title).toBe('Eight · Artist - YesPlayMusic');
  expect(ipc.send).toHaveBeenCalledWith(
    'playDiscordPresence',
    expect.objectContaining({ id: 8 })
  );
  platform.dispose();
  playback.dispose();
});
