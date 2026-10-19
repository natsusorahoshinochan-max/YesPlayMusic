/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import createLibrary from '@/store/modules/library';
import createPlaylistDetail from '@/store/modules/playlistDetail';
import createSession from '@/store/modules/session';
Vue.use(Vuex);
const operations = [
  [
    'setPlaylistFavorite',
    { id: 20, favorite: true },
    'subscribePlaylist',
    { id: 20, t: 1 },
  ],
  [
    'setAlbumFavorite',
    { id: 20, favorite: true },
    'likeAAlbum',
    { id: 20, t: 1 },
  ],
  [
    'setArtistFavorite',
    { id: 20, favorite: true },
    'followAArtist',
    { id: 20, t: 1 },
  ],
  ['setMVFavorite', { id: 20, favorite: true }, 'likeAMV', { mvid: 20, t: 1 }],
  ['toggleTrackFavorite', 20, 'likeATrack', { id: 20, like: true }],
  ['deletePlaylist', 20, 'deletePlaylist', 20],
  ['deleteCloudTrack', 20, 'cloudDiskTrackDelete', 20],
  [
    'uploadCloudTrack',
    { name: 'song.mp3' },
    'uploadSong',
    { name: 'song.mp3' },
  ],
];
function setup(mode = 'account', { likedSongPlaylistID = 99 } = {}) {
  const api = Object.fromEntries(
    operations.map(([, , endpoint]) => [
      endpoint,
      jest.fn().mockResolvedValue({ code: 200, privateCloud: { songId: 20 } }),
    ])
  );
  Object.assign(api, {
    userAccount: jest
      .fn()
      .mockResolvedValue({ code: 200, profile: { userId: 3 } }),
    userPlaylist: jest.fn().mockResolvedValue({
      playlist: [{ id: 99 }, { id: 20, subscribed: false }],
    }),
    userLikedSongsIDs: jest.fn().mockResolvedValue({ ids: [] }),
    getPlaylistDetail: jest.fn(id =>
      Promise.resolve({
        playlist: {
          id,
          subscribed: false,
          trackIds: [{ id: 1 }],
          trackCount: 1,
          tracks: [{ id: 1 }],
        },
      })
    ),
    getTrackDetail: jest.fn(ids =>
      Promise.resolve({
        songs: ids
          .split(',')
          .filter(Boolean)
          .map(id => ({ id: Number(id) })),
      })
    ),
    likedAlbums: jest.fn().mockResolvedValue({ data: [{ id: 20 }] }),
    likedArtists: jest.fn().mockResolvedValue({ data: [{ id: 20 }] }),
    likedMVs: jest.fn().mockResolvedValue({ data: [{ vid: 20 }] }),
    cloudDisk: jest.fn().mockResolvedValue({ data: [{ songId: 20 }] }),
  });
  const toast = jest.fn();
  const notifyLikedSongsChanged = jest.fn();
  const store = new Vuex.Store({
    actions: { showToast: toast },
    modules: {
      session: createSession(
        { loginMode: mode },
        {
          credentials: {
            get: () => (mode === 'account' ? 'credential' : null),
          },
        }
      ),
      library: createLibrary(
        { user: { userId: 3 }, likedSongPlaylistID },
        { api, notifyLikedSongsChanged }
      ),
      playlistDetail: createPlaylistDetail({ api }),
    },
  });
  return { store, api, toast, notifyLikedSongsChanged };
}

describe.each(operations)('%s', (action, input, endpoint, remoteInput) => {
  test.each([null, 'username'])(
    'denies %p identity without requests or UI effects',
    async mode => {
      const { store, api, toast } = setup(mode);
      expect(await store.dispatch(`library/${action}`, input)).toEqual({
        outcome: { status: 'denied', reason: 'account-required' },
        synchronization: 'not-required',
      });
      expect(api[endpoint]).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    }
  );
  test.each([
    [{ code: 200 }, 'succeeded'],
    [{ body: { code: 200 } }, 'succeeded'],
    [{ code: 403, message: 'refused' }, 'rejected'],
    [undefined, 'unconfirmed'],
  ])('interprets %p at the real module boundary', async (response, status) => {
    const { store, api } = setup();
    api[endpoint].mockResolvedValue(response);
    const result = await store.dispatch(`library/${action}`, input);
    expect(result.outcome.status).toBe(status);
    expect(api[endpoint]).toHaveBeenCalledWith(remoteInput);
    if (status !== 'succeeded')
      expect(result.synchronization).toBe('not-required');
  });
  test('transport failures are unconfirmed and programming errors propagate', async () => {
    const { store, api } = setup();
    api[endpoint].mockRejectedValueOnce(
      Object.assign(new Error('offline'), { isAxiosError: true })
    );
    expect(
      (await store.dispatch(`library/${action}`, input)).outcome.status
    ).toBe('unconfirmed');
    api[endpoint].mockRejectedValueOnce(new TypeError('adapter bug'));
    await expect(store.dispatch(`library/${action}`, input)).rejects.toThrow(
      'adapter bug'
    );
  });
});

test('confirmed playlist favorite survives both collection and metadata read failures', async () => {
  const { store, api } = setup();
  await store.dispatch('playlistDetail/open', 20);
  api.userPlaylist.mockRejectedValue(new Error('collection offline'));
  api.getPlaylistDetail.mockRejectedValue(new Error('metadata offline'));
  expect(
    await store.dispatch('library/setPlaylistFavorite', {
      id: 20,
      favorite: true,
    })
  ).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(store.getters['playlistDetail/current'].playlist.subscribed).toBe(
    true
  );
  expect(api.userPlaylist).toHaveBeenCalled();
});
test('confirmed deletion closes matching detail despite collection read failure', async () => {
  const { store, api } = setup();
  await store.dispatch('playlistDetail/open', 20);
  api.userPlaylist.mockRejectedValue(new Error('offline'));
  expect(
    (await store.dispatch('library/deletePlaylist', 20)).synchronization
  ).toBe('incomplete');
  expect(store.getters['playlistDetail/current']).toBeNull();
});
test('confirmed track unfavorite preserves membership, preview and detail removal when refreshes fail', async () => {
  const { store, api } = setup();
  api.userLikedSongsIDs.mockResolvedValue({ ids: [1, 2] });
  await store.dispatch('library/loadApplication');
  await store.dispatch('playlistDetail/open', 99);
  api.getPlaylistDetail.mockRejectedValue(new Error('offline'));
  expect(await store.dispatch('library/toggleTrackFavorite', 1)).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(store.getters['library/collections'].songs).toEqual([2]);
  expect(store.getters['library/collections'].songsWithDetails).toEqual([]);
  expect(store.getters['playlistDetail/current'].playlist.trackIds).toEqual([]);
});
test.each([
  ['setAlbumFavorite', 'likedAlbums', 'albums'],
  ['setArtistFavorite', 'likedArtists', 'artists'],
  ['setMVFavorite', 'likedMVs', 'mvs'],
  ['deleteCloudTrack', 'cloudDisk', 'cloudDisk'],
])(
  'confirmed %s preserves collection removal if reading it fails',
  async (action, endpoint, collection) => {
    const { store, api } = setup();
    await store.dispatch('library/loadApplication');
    api[endpoint].mockRejectedValue(new Error('offline'));
    const result = await store.dispatch(
      `library/${action}`,
      action === 'deleteCloudTrack' ? 20 : { id: 20, favorite: false }
    );
    expect(result).toEqual({
      outcome: { status: 'succeeded' },
      synchronization: 'incomplete',
    });
    expect(store.getters['library/collections'][collection]).toEqual([]);
  }
);
test('confirmed upload keeps returned track if cloud reading fails', async () => {
  const { store, api } = setup();
  api.cloudDisk.mockRejectedValue(new Error('offline'));
  expect(
    (await store.dispatch('library/uploadCloudTrack', { name: 'song.mp3' }))
      .synchronization
  ).toBe('incomplete');
  expect(store.getters['library/collections'].cloudDisk).toEqual([
    { songId: 20 },
  ]);
});
test('favorite and deletion of another playlist preserve current detail', async () => {
  const { store } = setup();
  await store.dispatch('playlistDetail/open', 30);
  await store.dispatch('library/setPlaylistFavorite', {
    id: 20,
    favorite: true,
  });
  await store.dispatch('library/deletePlaylist', 20);
  expect(store.getters['playlistDetail/current'].playlist.id).toBe(30);
});

test.each([
  ['setPlaylistFavorite', 'subscribePlaylist', { id: 20, t: 2 }],
  ['setAlbumFavorite', 'likeAAlbum', { id: 20, t: 0 }],
  ['setArtistFavorite', 'followAArtist', { id: 20, t: 0 }],
  ['setMVFavorite', 'likeAMV', { mvid: 20, t: 0 }],
])(
  '%s translates removing a favorite at the adapter boundary',
  async (action, endpoint, params) => {
    const { store, api } = setup();
    expect(
      (await store.dispatch(`library/${action}`, { id: 20, favorite: false }))
        .outcome.status
    ).toBe('succeeded');
    expect(api[endpoint]).toHaveBeenCalledWith(params);
  }
);
test('track favorite refreshes matching detail in remote order', async () => {
  const { store, api } = setup();
  await store.dispatch('playlistDetail/open', 99);
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      id: 99,
      trackIds: [{ id: 20 }, { id: 1 }],
      trackCount: 2,
      tracks: [{ id: 20 }, { id: 1 }],
    },
  });
  expect(await store.dispatch('library/toggleTrackFavorite', 20)).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'completed',
  });
  expect(store.getters['playlistDetail/current'].playlist.trackIds).toEqual([
    { id: 20 },
    { id: 1 },
  ]);
  expect(store.getters['library/collections'].songs).toEqual([20]);
  expect(store.getters['library/collections'].songsWithDetails).toEqual([
    { id: 20 },
    { id: 1 },
  ]);
});

test('track favorite discovers the liked playlist before synchronizing matching current detail', async () => {
  const { store, api } = setup('account', { likedSongPlaylistID: 0 });
  await store.dispatch('playlistDetail/open', 99);
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      id: 99,
      trackIds: [{ id: 20 }, { id: 1 }],
      tracks: [{ id: 20 }, { id: 1 }],
      trackCount: 2,
    },
  });
  expect(await store.dispatch('library/toggleTrackFavorite', 20)).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'completed',
  });
  expect(store.getters['library/likedSongPlaylistID']).toBe(99);
  expect(store.getters['playlistDetail/current'].playlist.trackIds).toEqual([
    { id: 20 },
    { id: 1 },
  ]);
  expect(store.getters['library/collections'].songsWithDetails).toEqual([
    { id: 20 },
    { id: 1 },
  ]);
});

test('a failing liked-song notification preserves confirmed write and allows preview and detail updates', async () => {
  const { store, api, notifyLikedSongsChanged } = setup();
  api.userLikedSongsIDs.mockResolvedValue({ ids: [1] });
  await store.dispatch('library/loadApplication');
  await store.dispatch('playlistDetail/open', 99);
  notifyLikedSongsChanged.mockImplementation(() => {
    throw new TypeError('notification unavailable');
  });
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      id: 99,
      trackIds: [],
      tracks: [],
      trackCount: 0,
    },
  });
  expect(await store.dispatch('library/toggleTrackFavorite', 1)).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(store.getters['library/collections'].songs).toEqual([]);
  expect(store.getters['library/collections'].songsWithDetails).toEqual([]);
  expect(store.getters['playlistDetail/current'].playlist.trackIds).toEqual([]);
});

test('confirmed track favorite retains loaded search results in the new ID order if range recovery fails', async () => {
  const { store, api } = setup();
  const trackIds = Array.from({ length: 750 }, (_, index) => ({
    id: index + 1,
  }));
  api.getPlaylistDetail.mockResolvedValue({
    playlist: { id: 99, trackIds, tracks: [{ id: 1 }], trackCount: 750 },
  });
  await store.dispatch('playlistDetail/open', 99);
  await store.dispatch('playlistDetail/loadMore', { count: 500 });
  const reordered = [{ id: 900 }, ...trackIds.slice(1)];
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      id: 99,
      trackIds: reordered,
      tracks: [{ id: 900 }],
      trackCount: 750,
    },
  });
  api.getTrackDetail
    .mockRejectedValueOnce(new Error('preview failed'))
    .mockRejectedValueOnce(new Error('range failed'));
  expect(await store.dispatch('library/toggleTrackFavorite', 900)).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  const current = store.getters['playlistDetail/current'];
  expect(current.tracks.map(track => track.id)).toEqual([
    900,
    ...Array.from({ length: 600 }, (_, index) => index + 2),
  ]);
  api.getTrackDetail.mockResolvedValue({ songs: [{ id: 602 }] });
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(api.getTrackDetail.mock.calls.at(-1)[0].split(',')[0]).toBe('602');
});

test.each([false, true])(
  'favorite confirmed during initial detail read survives stale metadata and refresh failure=%p',
  async failedRefresh => {
    const { store, api } = setup();
    let resolveInitial;
    api.getPlaylistDetail.mockReturnValueOnce(
      new Promise(resolve => {
        resolveInitial = resolve;
      })
    );
    const opening = store.dispatch('playlistDetail/open', 20);
    const stale = {
      playlist: {
        id: 20,
        subscribed: false,
        trackIds: [],
        tracks: [],
        trackCount: 0,
      },
    };
    if (failedRefresh)
      api.getPlaylistDetail.mockRejectedValueOnce(
        new Error('metadata unavailable')
      );
    else api.getPlaylistDetail.mockResolvedValueOnce(stale);
    expect(
      await store.dispatch('library/setPlaylistFavorite', {
        id: 20,
        favorite: true,
      })
    ).toEqual({
      outcome: { status: 'succeeded' },
      synchronization: failedRefresh ? 'incomplete' : 'completed',
    });
    resolveInitial(stale);
    await opening;
    if (failedRefresh) {
      api.getPlaylistDetail.mockResolvedValueOnce(stale);
      await store.dispatch('playlistDetail/open', 20);
    }
    expect(store.getters['playlistDetail/current'].playlist.subscribed).toBe(
      true
    );
    await store.dispatch('playlistDetail/open', 30);
    expect(store.getters['playlistDetail/current'].playlist.subscribed).toBe(
      false
    );
  }
);
