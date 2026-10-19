import { createPlayback } from '@/playback';
const track = id => ({ id, name: `Song ${id}`, dt: 180000, ar: [], al: {} });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup(options = {}) {
  const handles = [];
  const playback = createPlayback({
    getTrack: async id => track(id),
    resources: {
      resolve: async t => ({ kind: 'url', url: `/${t.id}` }),
      prefetch: async () => {},
    },
    audio: {
      prepare: async (resource, events) => {
        let position = 0;
        const h = {
          events,
          play: () => events.onPlay(),
          pause: () => events.onPause(),
          position: () => position,
          seek: v => {
            position = v;
          },
          setVolume() {},
          dispose() {},
        };
        handles.push(h);
        return h;
      },
    },
    setInterval: () => 1,
    clearInterval() {},
    ...options,
  });
  return { playback, handles };
}
test('next-list selection consumes the selected occurrence, playNow consumes the existing head and queue edits preserve main position', async () => {
  const { playback: p } = setup();
  await p.playTracks([1, 2, 1, 3]);
  p.enqueueNext(8);
  p.enqueueNext(8);
  p.enqueueNext(9);
  await p.playQueuedTrack(8, { group: 'next', index: 1 });
  expect(p.upcoming(4)).toEqual([
    { trackId: 8, group: 'next', index: 0 },
    { trackId: 9, group: 'next', index: 1 },
    { trackId: 2, group: 'main', index: 1 },
    { trackId: 1, group: 'main', index: 2 },
  ]);
  await p.enqueueNext(10, { playNow: true });
  expect(p.state.currentTrackID).toBe(8);
  p.removeNext(0);
  expect(p.upcoming(1)[0]).toEqual({ trackId: 10, group: 'next', index: 0 });
  p.clearNext();
  await p.next();
  expect(p.state.currentTrackID).toBe(2);
  await p.playQueuedTrack(1, { index: 2 });
  expect(p.upcoming(1)[0].trackId).toBe(3);
});
test('shuffle retains repeated occurrences and upcoming equals real traversal through reverse, wrap and repeat-one end', async () => {
  const { playback: p, handles } = setup({ random: () => 0 });
  p.toggleShuffle();
  await p.playTracks([1, 2, 1, 3], { startTrackId: 1 });
  expect(p.upcoming(10)).toEqual([
    { trackId: 1, group: 'main', index: 2 },
    { trackId: 3, group: 'main', index: 3 },
    { trackId: 2, group: 'main', index: 1 },
  ]);
  for (const id of [1, 3, 2]) {
    await p.next();
    expect(p.state.currentTrackID).toBe(id);
  }
  p.cycleRepeat();
  expect(p.upcoming(1)[0].trackId).toBe(1);
  await p.next();
  expect(p.state.currentTrackID).toBe(1);
  p.setReversed(true);
  expect(p.upcoming(1)[0].trackId).toBe(2);
  await p.next();
  expect(p.state.currentTrackID).toBe(2);
  p.cycleRepeat();
  handles[handles.length - 1].events.onEnd();
  await flush();
  expect(p.state.currentTrackID).toBe(2);
  await p.next();
  expect(p.state.currentTrackID).toBe(3);
  p.toggleShuffle();
  expect(p.upcoming(1)[0].trackId).toBe(1);
});
test('FM next and discard use recommendations, block modes and ignore late recommendation failures after a new queue', async () => {
  const late = deferred();
  const trash = jest.fn(async () => {});
  const load = jest
    .fn()
    .mockResolvedValueOnce([track(7), track(8)])
    .mockImplementationOnce(() => late.promise)
    .mockResolvedValue([track(9)]);
  const { playback: p, handles } = setup({
    personalFM: { load, trash },
    delay: async () => {},
  });
  await p.playPersonalFM();
  expect(p.state.currentTrackID).toBe(7);
  expect(p.state.personalFMNextTrack.id).toBe(8);
  p.cycleRepeat();
  p.toggleShuffle();
  p.setReversed(true);
  expect([p.state.repeatMode, p.state.shuffle, p.state.reversed]).toEqual([
    'off',
    false,
    false,
  ]);
  await p.discardFMTrack();
  expect(p.state.currentTrackID).toBe(8);
  expect(trash).toHaveBeenCalledWith(7);
  const old = handles[0];
  await p.playTracks([1, 2]);
  late.reject(new Error('late'));
  await flush();
  old.events.onEnd();
  await flush();
  expect(p.state.currentTrackID).toBe(1);
  expect(p.state.isPersonalFM).toBe(false);
  expect(p.state.personalFMNextLoading).toBe(false);
});
test('archive roundtrip preserves shuffled occurrence cursor, queue edits, modes and FM recommendations without autoplay', async () => {
  const { playback: p } = setup({ random: () => 0 });
  p.toggleShuffle();
  await p.playTracks([1, 2, 1, 3], { startTrackId: 1 });
  await p.next();
  p.cycleRepeat();
  p.setReversed(true);
  p.enqueueNext(8);
  p.setVolume(0.3);
  p.toggleMute();
  const saved = p.archive();
  const { playback: q } = setup();
  await q.restore(saved, 14);
  expect(q.archive()).toEqual({ ...saved, _progress: 14 });
  expect(q.upcoming(4)).toEqual(p.upcoming(4));
  expect(q.state.playing).toBe(false);
  q.toggleMute();
  expect(q.state.volume).toBe(0.3);
  const fm = setup({
    personalFM: {
      load: async () => [track(7), track(8)],
      trash: async () => {},
    },
  }).playback;
  await fm.playPersonalFM();
  const fmRestored = setup().playback;
  await fmRestored.restore(fm.archive(), 8);
  expect(fmRestored.state.isPersonalFM).toBe(true);
  expect(fmRestored.state.personalFMNextTrack.id).toBe(8);
  expect(fmRestored.state.playing).toBe(false);
});
test('unavailable repeated songs are skipped to a playable occurrence without looping repeat-all', async () => {
  const { playback: p } = setup({
    resources: {
      resolve: async t => (t.id === 1 ? null : { kind: 'url', url: '/ok' }),
      prefetch: async () => {},
    },
  });
  p.cycleRepeat();
  expect((await p.playTracks([1, 1, 3])).status).toBe('unavailable');
  expect(p.state.currentTrackID).toBe(3);
});
test('FM exhausted empty recommendations retries six times and superseded retry delay cannot select', async () => {
  const delay = jest.fn(async () => {});
  const load = jest.fn(async () => []);
  const feedback = [];
  const { playback: p } = setup({
    personalFM: { load, trash: async () => {} },
    delay,
    onFeedback: event => feedback.push(event),
  });
  expect((await p.playPersonalFM()).status).toBe('unavailable');
  expect(load).toHaveBeenCalledTimes(6);
  expect(delay).toHaveBeenCalledTimes(5);
  expect(feedback.map(e => e.reason)).toEqual(['fm-empty']);
  const waiting = deferred();
  load.mockClear();
  const { playback: q } = setup({
    personalFM: { load, trash: async () => {} },
    delay: () => waiting.promise,
  });
  const old = q.playPersonalFM();
  await flush();
  await q.playTracks([5]);
  waiting.resolve();
  expect(await old).toEqual({ status: 'superseded' });
  expect(q.state.currentTrackID).toBe(5);
  expect(load).toHaveBeenCalledTimes(1);
});
test('restore can prepare missing FM recommendations while keeping ordinary mode and later user selection owns late initialization', async () => {
  const ready = deferred();
  const { playback: p } = setup({
    personalFM: { load: () => ready.promise, trash: async () => {} },
  });
  await p.restore({ _list: [1, 2], _current: 0, _enabled: false }, 0, {
    preparePersonalFM: true,
  });
  ready.resolve([track(7), track(8)]);
  await flush();
  expect(p.state.isPersonalFM).toBe(false);
  expect(p.state.personalFMTrack.id).toBe(7);
  expect(p.state.personalFMNextTrack.id).toBe(8);
  expect(p.state.enabled).toBe(false);
  const late = deferred();
  const { playback: q } = setup({
    personalFM: { load: () => late.promise, trash: async () => {} },
  });
  await q.restore({}, 0, { preparePersonalFM: true });
  await q.playTracks([5]);
  late.resolve([track(9), track(10)]);
  await flush();
  expect(q.state.currentTrackID).toBe(5);
  expect(q.state.personalFMTrack.id).toBe(0);
});
test('FM entry controls keep explicit FM intent from ordinary playback and upcoming selection consumes the recommendation', async () => {
  const trash = jest.fn(async () => {});
  const { playback: p } = setup({
    personalFM: { load: async () => [track(7), track(8)], trash },
  });
  await p.playPersonalFM();
  await p.playTracks([1, 2]);
  expect((await p.next({ personalFM: true })).status).toBe('completed');
  expect(p.state.currentTrackID).toBe(8);
  expect(p.state.isPersonalFM).toBe(true);
  const { playback: q } = setup({
    personalFM: { load: async () => [track(7), track(8)], trash },
  });
  await q.playPersonalFM();
  await q.playTracks([1, 2]);
  await q.discardFMTrack();
  expect(q.state.currentTrackID).toBe(8);
  expect(trash).toHaveBeenCalledWith(7);
  const { playback: r } = setup({
    personalFM: { load: async () => [track(7), track(8)], trash },
  });
  await r.playPersonalFM();
  const row = r.upcoming(1)[0];
  expect(await r.playQueuedTrack(row.trackId, row)).toEqual({
    status: 'completed',
  });
  expect(r.state.currentTrackID).toBe(8);
  expect(r.state.isPersonalFM).toBe(true);
});
test('rejected FM requests report a failed outcome and one matching application feedback', async () => {
  const feedback = [];
  const { playback: p } = setup({
    personalFM: {
      load: async () => {
        throw new Error('network');
      },
    },
    onFeedback: event => feedback.push(event),
  });
  expect(await p.playPersonalFM()).toEqual({
    status: 'failed',
    reason: 'fm-timeout',
  });
  expect(feedback.map(({ status, reason }) => ({ status, reason }))).toEqual([
    { status: 'failed', reason: 'fm-timeout' },
  ]);
});
