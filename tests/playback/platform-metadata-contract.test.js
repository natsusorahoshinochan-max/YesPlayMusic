import { EventEmitter } from 'events';
import { createLyrics } from '@/lyrics';
import { createPlaybackPlatform } from '@/application/playbackPlatform';

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function setup() {
  let position = 0;
  const track = id => ({ id, name: `Track ${id}`, ar: [], al: {} });
  const playback = {
    state: {
      currentTrack: track(1),
      currentTrackID: 1,
      sourceInfo: { type: 'online' },
      durationSeconds: 120,
      progress: 0,
      playing: false,
    },
    position: () => position,
  };
  const getLyric = jest.fn(() =>
    Promise.resolve({ lrc: { lyric: '[00:00.00]First\n[00:10.00]Second' } })
  );
  const lyrics = createLyrics({
    playback,
    getIdentity: () => ({ hasAccount: false }),
    getLyric,
  });
  const ipc = new EventEmitter();
  ipc.send = jest.fn();
  const platform = createPlaybackPlatform({
    playback,
    lyrics,
    ipc,
    navigator: {},
    settings: () => ({ enableOsdlyricsSupport: true }),
    createTouchBar: true,
    createTray: false,
    createMpris: true,
  });
  const messages = channel =>
    ipc.send.mock.calls
      .filter(([name]) => name === channel)
      .map(([, data]) => data);
  const publish = () => platform.publish({ ...playback.state });
  const select = (id, sourceInfo = { type: 'online' }) => {
    Object.assign(playback.state, {
      currentTrack: track(id),
      currentTrackID: id,
      sourceInfo,
    });
    lyrics.sync();
    publish();
  };
  return {
    lyrics,
    ipc,
    getLyric,
    messages,
    publish,
    select,
    move(seconds) {
      position = seconds;
      lyrics.position();
    },
    dispose() {
      platform.dispose();
      lyrics.dispose();
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('lyric lines and repeated playback publication preserve the pending metadata handshake', async () => {
  const app = setup();
  try {
    app.select(1);
    await flush();
    const [write] = app.messages('sendLyrics');
    expect(write.lyrics).toContain('First');
    app.move(12);
    app.publish();
    expect(app.messages('updateLyric').at(-1)).toEqual({ lyric: 'Second' });
    expect(app.messages('sendLyrics')).toHaveLength(1);
    expect(app.messages('metadata')).toHaveLength(0);
    app.ipc.emit('saveLyricFinished', {}, write.requestId);
    expect(app.messages('metadata').map(value => value.trackId)).toEqual([1]);
    jest.runOnlyPendingTimers();
    expect(app.messages('metadata')).toHaveLength(1);
  } finally {
    app.dispose();
  }
});

test('retry and track replacement cancel old acknowledgements; current content publishes once', async () => {
  const app = setup();
  try {
    app.select(1);
    await flush();
    const first = app.messages('sendLyrics')[0];
    app.getLyric.mockResolvedValueOnce({ lrc: { lyric: '[00:00.00]Revised' } });
    const retry = app.lyrics.retry();
    app.ipc.emit('saveLyricFinished', {}, first.requestId);
    expect(app.messages('metadata')).toHaveLength(0);
    await retry;
    const revised = app.messages('sendLyrics')[1];
    expect(revised.lyrics).toContain('Revised');
    app.select(2);
    app.ipc.emit('saveLyricFinished', {}, revised.requestId);
    expect(app.messages('metadata')).toHaveLength(0);
    await flush();
    const current = app.messages('sendLyrics').at(-1);
    expect(current.track.id).toBe(2);
    jest.runOnlyPendingTimers();
    app.ipc.emit('saveLyricFinished', {}, current.requestId);
    expect(app.messages('metadata').map(value => value.trackId)).toEqual([2]);
  } finally {
    app.dispose();
  }
});

test('a target without an audio source waits for source adoption; disposal cancels its handshake', async () => {
  const app = setup();
  try {
    app.select(1);
    await flush();
    const first = app.messages('sendLyrics')[0];
    app.select(2, null);
    await flush();
    app.ipc.emit('saveLyricFinished', {}, first.requestId);
    expect(app.messages('sendLyrics')).toHaveLength(1);
    expect(app.messages('metadata')).toHaveLength(0);
    app.select(2);
    await flush();
    expect(app.messages('sendLyrics')).toHaveLength(2);
    const current = app.messages('sendLyrics')[1];
    expect(current.track.id).toBe(2);
    app.dispose();
    app.ipc.emit('saveLyricFinished', {}, current.requestId);
    jest.runOnlyPendingTimers();
    expect(app.messages('metadata')).toHaveLength(0);
  } finally {
    app.dispose();
  }
});
