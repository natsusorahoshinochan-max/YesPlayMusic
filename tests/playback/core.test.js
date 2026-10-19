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
