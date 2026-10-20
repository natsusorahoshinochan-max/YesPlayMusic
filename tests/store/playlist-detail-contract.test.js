import Vue from 'vue';
import Vuex from 'vuex';
import createLibrary from '@/store/modules/library';
import createPlaylistDetail from '@/store/modules/playlistDetail';

Vue.use(Vuex);

const track = id => ({ id, name: `Song ${id}` });
const sequence = length => Array.from({ length }, (_, index) => index + 1);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function fixture({ initialCount = 100, length = 200, account = true } = {}) {
  let ids = sequence(length);
  const api = {
    getPlaylistDetail: jest.fn(async id => ({
      playlist: {
        id,
        trackCount: ids.length,
        trackIds: ids.map(id => ({ id })),
        tracks: ids.slice(0, initialCount).map(track),
      },
    })),
    getTrackDetail: jest.fn(async batch => ({
      songs: batch.split(',').map(Number).map(track),
    })),
    addOrRemoveTrackFromPlaylist: jest.fn(async () => ({ code: 200 })),
    userPlaylist: jest.fn(async () => ({ playlist: [] })),
  };
  const store = new Vuex.Store({
    modules: {
      session: {
        namespaced: true,
        getters: { hasAccount: () => account },
      },
      library: createLibrary(
        { user: { userId: 7 }, likedSongPlaylistID: 0 },
        { api }
      ),
      playlistDetail: createPlaylistDetail({ api }),
    },
  });
  return {
    store,
    api,
    current: () => store.getters['playlistDetail/current'],
    replaceIds(value) {
      ids = value;
    },
  };
}

test.each(['addPlaylistTracks', 'removePlaylistTracks'])(
  '%s requires an account before writing or updating details',
  async action => {
    const { store, api, current } = fixture({ account: false });
    await store.dispatch('playlistDetail/open', 10);
    const ids = current().tracks.map(song => song.id);

    await expect(
      store.dispatch(`library/${action}`, { playlistId: 10, trackIds: [1] })
    ).resolves.toEqual({
      outcome: { status: 'denied', reason: 'account-required' },
      synchronization: 'not-required',
    });
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
    expect(api.userPlaylist).not.toHaveBeenCalled();
    expect(current().tracks.map(song => song.id)).toEqual(ids);
  }
);

test('confirmed removal updates details even when refreshing the collection fails', async () => {
  const { store, api, current } = fixture();
  await store.dispatch('playlistDetail/open', 10);
  api.userPlaylist.mockRejectedValueOnce(new Error('collection offline'));

  await expect(
    store.dispatch('library/removePlaylistTracks', {
      playlistId: 10,
      trackIds: [1],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
    op: 'del',
    pid: 10,
    tracks: '1',
  });
  expect(current().tracks.some(song => song.id === 1)).toBe(false);
  expect(current().playlist.trackCount).toBe(199);
});

test('confirmed addition with an incomplete detail refresh keeps the inserted song available to subsequent pagination', async () => {
  const { store, api, current, replaceIds } = fixture();
  await store.dispatch('playlistDetail/open', 10);
  expect(current().tracks).toHaveLength(200);
  const changed = sequence(200);
  [changed[100], changed[101]] = [102, 101];
  changed.splice(120, 0, 999);
  replaceIds(changed);
  api.getTrackDetail.mockRejectedValueOnce(new Error('metadata offline'));

  await expect(
    store.dispatch('library/addPlaylistTracks', {
      playlistId: 10,
      trackIds: [999],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(current().tracks).toHaveLength(200);
  expect(
    current()
      .tracks.slice(100, 103)
      .map(song => song.id)
  ).toEqual([102, 101, 103]);
  expect(current().hasMore).toBe(true);

  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  const retry = api.getTrackDetail.mock.calls.at(-1)[0].split(',').map(Number);
  expect(retry).toContain(999);
  expect(current().tracks.map(song => song.id)).toEqual(changed);
  expect(current().hasMore).toBe(true);
  await store.dispatch('playlistDetail/loadMore', { count: 500 });
  expect(current().hasMore).toBe(false);
});

test.each([100, 500])(
  'a failed refresh of a 150-song view can resume with a %i-song request',
  async count => {
    const { store, api, current, replaceIds } = fixture({ initialCount: 50 });
    await store.dispatch('playlistDetail/open', 10);
    expect(current().tracks).toHaveLength(150);
    const changed = sequence(200);
    changed.splice(120, 0, 999);
    replaceIds(changed);
    api.getTrackDetail.mockRejectedValueOnce(new Error('metadata offline'));
    await expect(
      store.dispatch('library/addPlaylistTracks', {
        playlistId: 10,
        trackIds: [999],
      })
    ).resolves.toMatchObject({ synchronization: 'incomplete' });

    await store.dispatch('playlistDetail/loadMore', { count });
    const requested = api.getTrackDetail.mock.calls
      .at(-1)[0]
      .split(',')
      .map(Number);
    expect(requested[0]).toBe(51);
    expect(requested).toContain(999);
    expect(requested).toHaveLength(count === 100 ? 100 : 151);
    expect(current().tracks.some(song => song.id === 999)).toBe(true);
    expect(current().hasMore).toBe(count === 100);
    await store.dispatch('playlistDetail/loadMore', { count: 500 });
    expect(current().tracks.map(song => song.id)).toEqual(changed);
    expect(current().hasMore).toBe(false);
  }
);

test.each([
  ['close', 'resolve'],
  ['close', 'reject'],
  ['open', 'resolve'],
  ['open', 'reject'],
])(
  'a detail refresh cannot change the active view after %s when the old request will %s',
  async (action, settlement) => {
    const { store, api, current, replaceIds } = fixture();
    await store.dispatch('playlistDetail/open', 10);
    const changed = sequence(200);
    changed.splice(120, 0, 999);
    replaceIds(changed);
    const pending = deferred();
    const started = deferred();
    api.getTrackDetail.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const addition = store.dispatch('library/addPlaylistTracks', {
      playlistId: 10,
      trackIds: [999],
    });
    await started.promise;
    if (action === 'close') await store.dispatch('playlistDetail/close');
    else await store.dispatch('playlistDetail/open', 20);
    const expected = current() && {
      id: current().id,
      ids: current().tracks.map(song => song.id),
      hasMore: current().hasMore,
    };
    if (settlement === 'resolve') pending.resolve({ songs: [track(999)] });
    else pending.reject(new Error('old metadata request failed'));
    await addition;

    if (action === 'close') expect(current()).toBeNull();
    else {
      expect(current().id).toBe(expected.id);
      expect(current().tracks.map(song => song.id)).toEqual(expected.ids);
      expect(current().hasMore).toBe(expected.hasMore);
      expect(current().loading).toBe(false);
      expect(current().loadingMore).toBe(false);
    }
  }
);

test('successful requests advance past unavailable songs even when the remote service returns fewer details', async () => {
  const { store, api, current } = fixture({ initialCount: 0, length: 205 });
  api.getTrackDetail
    .mockResolvedValueOnce({ songs: [track(1), track(100)] })
    .mockResolvedValueOnce({ songs: [] })
    .mockResolvedValueOnce({ songs: [track(205)] });
  await store.dispatch('playlistDetail/open', 10);
  expect(current().tracks.map(song => song.id)).toEqual([1, 100]);
  expect(current().hasMore).toBe(true);
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(current().hasMore).toBe(true);
  await store.dispatch('playlistDetail/loadMore', { count: 500 });
  expect(
    api.getTrackDetail.mock.calls.map(([batch]) => batch.split(',')[0])
  ).toEqual(['1', '101', '201']);
  expect(current().tracks.map(song => song.id)).toEqual([1, 100, 205]);
  expect(current().hasMore).toBe(false);
});
