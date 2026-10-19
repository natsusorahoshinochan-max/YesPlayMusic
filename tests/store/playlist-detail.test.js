/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import createPlaylistDetail from '@/store/modules/playlistDetail';
Vue.use(Vuex);

function setup(api) {
  return new Vuex.Store({
    modules: { playlistDetail: createPlaylistDetail({ api }) },
  });
}
const ids = count => Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
const songs = values => values.map(id => ({ id, name: `Song ${id}` }));
function remote(count = 750) {
  return {
    getPlaylistDetail: jest.fn(id =>
      Promise.resolve({
        playlist: {
          id,
          trackCount: count,
          trackIds: ids(count),
          tracks: songs([1, 3]),
        },
      })
    ),
    getTrackDetail: jest.fn(batch =>
      Promise.resolve({
        songs: songs(
          batch
            .split(',')
            .map(Number)
            .filter(id => id !== 105)
        ),
      })
    ),
  };
}

test('detail traverses complete ordered IDs when metadata and subsequent batches omit songs', async () => {
  const api = remote();
  const store = setup(api);
  await store.dispatch('playlistDetail/open', 20);
  expect(api.getTrackDetail).toHaveBeenLastCalledWith(
    ids(103)
      .slice(3)
      .map(t => t.id)
      .join(',')
  );
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(api.getTrackDetail.mock.calls[1][0].split(',').slice(0, 3)).toEqual([
    '104',
    '105',
    '106',
  ]);
  const current = store.getters['playlistDetail/current'];
  expect(current.playlist.trackIds).toHaveLength(750);
  expect(current.tracks.some(t => t.id === 105)).toBe(false);
  expect(current.hasMore).toBe(true);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('opening another detail and closing it discards earlier metadata reads', async () => {
  const first = deferred();
  const api = remote(3);
  api.getPlaylistDetail.mockReturnValueOnce(first.promise);
  const store = setup(api);
  const opening = store.dispatch('playlistDetail/open', 1);
  await store.dispatch('playlistDetail/open', 2);
  first.resolve({ playlist: { id: 1, trackIds: [], tracks: [] } });
  await opening;
  expect(store.getters['playlistDetail/current'].playlist.id).toBe(2);
  const next = deferred();
  api.getPlaylistDetail.mockReturnValueOnce(next.promise);
  const closing = store.dispatch('playlistDetail/open', 3);
  await store.dispatch('playlistDetail/close');
  next.resolve({ playlist: { id: 3, trackIds: [], tracks: [] } });
  await closing;
  expect(store.getters['playlistDetail/current']).toBeNull();
});

test('a reload supersedes pending pagination and restores the traversed range in remote order', async () => {
  const api = remote(300);
  const store = setup(api);
  await store.dispatch('playlistDetail/open', 20);
  const stale = deferred();
  api.getTrackDetail.mockReturnValueOnce(stale.promise);
  const pagination = store.dispatch('playlistDetail/loadMore', { count: 100 });
  api.getPlaylistDetail.mockResolvedValueOnce({
    playlist: {
      id: 20,
      trackCount: 300,
      trackIds: [{ id: 900 }, ...ids(299)],
      tracks: songs([900, 1]),
    },
  });
  await store.dispatch('playlistDetail/applyLibraryChange', {
    type: 'tracks-added',
    playlistId: 20,
  });
  stale.resolve({ songs: songs([888]) });
  await pagination;
  const current = store.getters['playlistDetail/current'];
  expect(current.tracks[0].id).toBe(900);
  expect(current.tracks.some(t => t.id === 888)).toBe(false);
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(api.getTrackDetail.mock.calls.at(-1)[0].split(',')[0]).toBe('103');
});
test('removing traversed and pending IDs during pagination cannot resurrect deleted tracks', async () => {
  const api = remote(300),
    store = setup(api);
  await store.dispatch('playlistDetail/open', 20);
  const stale = deferred();
  api.getTrackDetail.mockReturnValueOnce(stale.promise);
  const pagination = store.dispatch('playlistDetail/loadMore', { count: 100 });
  await store.dispatch('playlistDetail/applyLibraryChange', {
    type: 'tracks-removed',
    playlistId: 20,
    trackIds: [1, 104, 107],
  });
  stale.resolve({ songs: songs([104, 106, 107, 203]) });
  await pagination;
  const current = store.getters['playlistDetail/current'];
  expect(current.tracks.some(t => [1, 104, 107].includes(t.id))).toBe(false);
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(api.getTrackDetail.mock.calls.at(-1)[0].split(',')[0]).toBe('204');
});
