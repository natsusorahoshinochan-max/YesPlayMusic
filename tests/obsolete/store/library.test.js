/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import createLibrary from '@/store/modules/library';
Vue.use(Vuex);

function setup(api, account = true, notifyLikedSongsChanged = () => {}) {
  return new Vuex.Store({
    getters: {
      'session/hasAccount': () => account,
      'session/hasLibraryIdentity': () => true,
    },
    actions: { showToast: jest.fn() },
    modules: {
      library: createLibrary(
        { user: { userId: 3 }, likedSongPlaylistID: 99 },
        { api, notifyLikedSongsChanged }
      ),
    },
  });
}
function endpoints() {
  return {
    userAccount: jest
      .fn()
      .mockResolvedValue({ code: 200, profile: { userId: 7 } }),
    userPlaylist: jest.fn().mockResolvedValue({ playlist: [{ id: 20 }] }),
    getPlaylistDetail: jest
      .fn()
      .mockResolvedValue({ playlist: { trackIds: [{ id: 50 }] } }),
    getTrackDetail: jest
      .fn()
      .mockResolvedValue({ songs: [{ id: 50, name: 'preview' }] }),
    userLikedSongsIDs: jest.fn().mockResolvedValue({ ids: [50] }),
    likedAlbums: jest.fn().mockResolvedValue({ data: [] }),
    likedArtists: jest.fn().mockResolvedValue({ data: [] }),
    likedMVs: jest.fn().mockResolvedValue({ data: [] }),
    cloudDisk: jest.fn().mockResolvedValue({ data: [] }),
    userPlayHistory: jest.fn(({ type }) =>
      Promise.resolve({ [type ? 'weekData' : 'allData']: [] })
    ),
  };
}

test('account page waits for profile and playlists before preview and becomes ready independently of albums', async () => {
  const api = endpoints();
  api.likedAlbums.mockReturnValue(new Promise(() => {}));
  const store = setup(api);
  await store.dispatch('library/loadPage');
  expect(api.userPlaylist).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 7 })
  );
  expect(api.getPlaylistDetail).toHaveBeenCalledWith(20, true);
  expect(api.getTrackDetail).toHaveBeenCalledWith('50');
  expect(store.getters['library/previewReady']).toBe(true);
  expect(store.getters['library/collections'].songsWithDetails).toEqual([
    { id: 50, name: 'preview' },
  ]);
});

test('public library identity loads public playlists and a limited preview without privileged endpoints, including an empty refresh', async () => {
  const api = endpoints();
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      trackIds: Array.from({ length: 15 }, (_, i) => ({ id: i + 1 })),
    },
  });
  const store = setup(api, false);
  await store.dispatch('library/loadApplication');
  expect(store.getters['library/collections'].songs).toHaveLength(15);
  expect(api.getTrackDetail).toHaveBeenCalledWith('1,2,3,4,5,6,7,8,9,10,11,12');
  for (const endpoint of [
    'userAccount',
    'userLikedSongsIDs',
    'likedAlbums',
    'likedArtists',
    'likedMVs',
    'cloudDisk',
    'userPlayHistory',
  ]) {
    expect(api[endpoint]).not.toHaveBeenCalled();
  }
  api.userPlaylist.mockResolvedValue({ playlist: [] });
  await store.dispatch('library/refreshPlaylists');
  expect(store.getters['library/collections'].songsWithDetails).toEqual([]);
  expect(store.getters['library/previewReady']).toBe(true);
});

test('track favorite updates reactive membership and desktop effect before refreshing its preview', async () => {
  const api = endpoints();
  api.likeATrack = jest.fn().mockResolvedValue({ code: 200 });
  const desktop = jest.fn();
  let store;
  store = setup(api, true, () =>
    desktop(store.getters['library/collections'].songs.includes(50))
  );
  await store.dispatch('library/toggleTrackFavorite', 50);
  expect(api.likeATrack).toHaveBeenCalledWith({ id: 50, like: true });
  expect(desktop).toHaveBeenLastCalledWith(true);
  expect(store.getters['library/collections'].songsWithDetails[0].name).toBe(
    'preview'
  );
  await store.dispatch('library/toggleTrackFavorite', 50);
  expect(api.likeATrack).toHaveBeenLastCalledWith({ id: 50, like: false });
  expect(desktop).toHaveBeenLastCalledWith(false);
});

test.each([
  ['setAlbumFavorite', 'likeAAlbum', 'likedAlbums', 'albums', { id: 12, t: 1 }],
  [
    'setArtistFavorite',
    'followAArtist',
    'likedArtists',
    'artists',
    { id: 12, t: 1 },
  ],
  ['setMVFavorite', 'likeAMV', 'likedMVs', 'mvs', { mvid: 12, t: 1 }],
])(
  '%s completes the mutation and collection refresh, and failure leaves the collection intact',
  async (action, endpoint, loader, name, params) => {
    const api = endpoints();
    api[endpoint] = jest.fn().mockResolvedValue({ code: 200 });
    api[loader].mockResolvedValue({ data: [{ id: 12 }] });
    const store = setup(api);
    await store.dispatch(`library/${action}`, { id: 12, favorite: true });
    expect(api[endpoint]).toHaveBeenCalledWith(params);
    expect(store.getters['library/collections'][name]).toEqual([{ id: 12 }]);
    api[endpoint].mockResolvedValue({ code: 500 });
    api[loader].mockClear();
    await store.dispatch(`library/${action}`, { id: 12, favorite: false });
    expect(api[loader]).not.toHaveBeenCalled();
    expect(store.getters['library/collections'][name]).toEqual([{ id: 12 }]);
  }
);

test('creating a playlist with an initial track completes both writes before refreshing playlists', async () => {
  const api = endpoints();
  api.createPlaylist = jest.fn().mockResolvedValue({ code: 200, id: 25 });
  api.addOrRemoveTrackFromPlaylist = jest
    .fn()
    .mockResolvedValue({ body: { code: 200 } });
  api.userPlaylist.mockResolvedValue({
    playlist: [{ id: 20 }, { id: 25, trackCount: 1 }],
  });
  const store = setup(api);
  await store.dispatch('library/createPlaylist', {
    name: 'New',
    privacy: true,
    trackID: 51,
  });
  expect(api.createPlaylist).toHaveBeenCalledWith({ name: 'New', privacy: 10 });
  expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
    op: 'add',
    pid: 25,
    tracks: 51,
  });
  expect(store.getters['library/collections'].playlists[1]).toEqual({
    id: 25,
    trackCount: 1,
  });
});

test('playlist favorites refresh collection and tracks in the liked playlist refresh membership and desktop', async () => {
  const api = endpoints();
  api.subscribePlaylist = jest.fn().mockResolvedValue({ code: 200 });
  api.addOrRemoveTrackFromPlaylist = jest
    .fn()
    .mockResolvedValue({ body: { code: 200 } });
  const notify = jest.fn();
  const store = setup(api, true, notify);
  await store.dispatch('library/setPlaylistFavorite', {
    id: 26,
    favorite: false,
  });
  expect(api.subscribePlaylist).toHaveBeenCalledWith({ id: 26, t: 2 });
  expect(store.getters['library/likedSongPlaylistID']).toBe(20);
  await store.dispatch('library/changePlaylistTracks', {
    op: 'add',
    pid: 20,
    tracks: 50,
  });
  expect(store.getters['library/collections'].songs).toEqual([50]);
  expect(notify).toHaveBeenCalled();
  expect(store.getters['library/collections'].songsWithDetails[0].name).toBe(
    'preview'
  );
});

test('cloud upload and deletion update the public collection only after accepted writes', async () => {
  const api = endpoints();
  const file = new File(['song'], 'song.mp3');
  api.uploadSong = jest
    .fn()
    .mockResolvedValue({ code: 200, privateCloud: { songId: 50 } });
  api.cloudDiskTrackDelete = jest.fn().mockResolvedValue({ code: 500 });
  const store = setup(api);
  await store.dispatch('library/uploadCloudTrack', file);
  expect(api.uploadSong).toHaveBeenCalledWith(file);
  expect(store.getters['library/collections'].cloudDisk).toEqual([
    { songId: 50 },
  ]);
  await store.dispatch('library/deleteCloudTrack', 50);
  expect(store.getters['library/collections'].cloudDisk).toHaveLength(1);
  api.cloudDiskTrackDelete.mockResolvedValue({ code: 200 });
  await store.dispatch('library/deleteCloudTrack', 50);
  expect(store.getters['library/collections'].cloudDisk).toEqual([]);
});

test('playlist deletion refreshes the public collection and denied favorite writes never reach endpoints', async () => {
  const api = endpoints();
  api.deletePlaylist = jest.fn().mockResolvedValue({ code: 200 });
  api.likeATrack = jest.fn();
  const account = setup(api);
  await account.dispatch('library/deletePlaylist', 30);
  expect(api.deletePlaylist).toHaveBeenCalledWith(30);
  expect(account.getters['library/collections'].playlists).toEqual([
    { id: 20 },
  ]);
  const publicIdentity = setup(api, false);
  await publicIdentity.dispatch('library/toggleTrackFavorite', 50);
  expect(api.likeATrack).not.toHaveBeenCalled();
});
