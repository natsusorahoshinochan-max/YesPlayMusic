/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import createLibrary from '@/store/modules/library';
import createPlaylistDetail from '@/store/modules/playlistDetail';
import createSession from '@/store/modules/session';
Vue.use(Vuex);
function setup(mode = 'account') {
  const api = {
    getPlaylistDetail: jest.fn(id =>
      Promise.resolve({
        playlist: {
          id,
          trackIds: Array.from({ length: 750 }, (_, i) => ({ id: i + 1 })),
          trackCount: 750,
          tracks: [{ id: 1 }],
        },
      })
    ),
    getTrackDetail: jest.fn(ids =>
      Promise.resolve({
        songs: ids
          .split(',')
          .map(Number)
          .filter(id => id !== 102)
          .map(id => ({ id })),
      })
    ),
    addOrRemoveTrackFromPlaylist: jest
      .fn()
      .mockResolvedValue({ body: { code: 200 } }),
    userPlaylist: jest
      .fn()
      .mockResolvedValue({ playlist: [{ id: 20, trackCount: 747 }] }),
  };
  const store = new Vuex.Store({
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
        { user: { userId: 3 }, likedSongPlaylistID: 99 },
        { api }
      ),
      playlistDetail: createPlaylistDetail({ api }),
    },
  });
  return { store, api };
}
test.each([null, 'username'])(
  'account-required removal sends no request for %p identity',
  async mode => {
    const { store, api } = setup(mode);
    await expect(
      store.dispatch('library/removePlaylistTracks', {
        playlistId: 20,
        trackIds: [1],
      })
    ).resolves.toEqual({
      outcome: { status: 'denied', reason: 'account-required' },
      synchronization: 'not-required',
    });
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
  }
);
test('search expansion then removal updates detail, collections, counts and next traversed ID', async () => {
  const { store, api } = setup();
  await store.dispatch('playlistDetail/open', 20);
  await store.dispatch('playlistDetail/loadMore', { count: 500 });
  const result = await store.dispatch('library/removePlaylistTracks', {
    playlistId: 20,
    trackIds: [1, 102, 603, 9999],
  });
  expect(result).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'completed',
  });
  const current = store.getters['playlistDetail/current'];
  expect(current.playlist.trackCount).toBe(747);
  expect(
    current.playlist.trackIds.some(t => [1, 102, 603].includes(t.id))
  ).toBe(false);
  expect(current.tracks.some(t => t.id === 1)).toBe(false);
  expect(store.getters['library/collections'].playlists).toEqual([
    { id: 20, trackCount: 747 },
  ]);
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(
    api.getTrackDetail.mock.calls.at(-1)[0].split(',').slice(0, 3)
  ).toEqual(['602', '604', '605']);
  expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
    op: 'del',
    pid: 20,
    tracks: '1,102,603,9999',
  });
});

test.each([
  [{ code: 200 }, 'succeeded', 'completed'],
  [{ body: { code: 502, message: '拒绝删除' } }, 'rejected', 'not-required'],
  [undefined, 'unconfirmed', 'not-required'],
])(
  'removal interprets remote outcome %p',
  async (response, status, synchronization) => {
    const { store, api } = setup();
    api.addOrRemoveTrackFromPlaylist.mockResolvedValue(response);
    const result = await store.dispatch('library/removePlaylistTracks', {
      playlistId: 20,
      trackIds: [1],
    });
    expect(result).toMatchObject({ outcome: { status }, synchronization });
  }
);
test('confirmed removal updates detail even when refreshing the collection fails', async () => {
  const { store, api } = setup();
  await store.dispatch('playlistDetail/open', 20);
  api.userPlaylist.mockRejectedValue(new Error('read unavailable'));
  const result = await store.dispatch('library/removePlaylistTracks', {
    playlistId: 20,
    trackIds: [1],
  });
  expect(result).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(
    store.getters['playlistDetail/current'].tracks.some(t => t.id === 1)
  ).toBe(false);
});
test('transport errors are unconfirmed but programming errors propagate', async () => {
  const { store, api } = setup();
  api.addOrRemoveTrackFromPlaylist.mockRejectedValueOnce(
    Object.assign(new Error('timeout'), { isAxiosError: true })
  );
  await expect(
    store.dispatch('library/removePlaylistTracks', {
      playlistId: 20,
      trackIds: [1],
    })
  ).resolves.toMatchObject({ outcome: { status: 'unconfirmed' } });
  api.addOrRemoveTrackFromPlaylist.mockRejectedValueOnce(
    new TypeError('bad adapter')
  );
  await expect(
    store.dispatch('library/removePlaylistTracks', {
      playlistId: 20,
      trackIds: [1],
    })
  ).rejects.toThrow('bad adapter');
});
test('removing tracks from another playlist preserves the opened detail', async () => {
  const { store } = setup();
  await store.dispatch('playlistDetail/open', 20);
  await store.dispatch('library/removePlaylistTracks', {
    playlistId: 30,
    trackIds: [1],
  });
  expect(store.getters['playlistDetail/current'].tracks[0].id).toBe(1);
});
test('liked music removal attempts preview and detail synchronization despite collection and IDs read failures', async () => {
  const { store, api } = setup();
  await store.dispatch('playlistDetail/open', 99);
  api.userPlaylist.mockRejectedValue(new Error('collection read failed'));
  api.userLikedSongsIDs = jest
    .fn()
    .mockRejectedValue(new Error('IDs read failed'));
  const result = await store.dispatch('library/removePlaylistTracks', {
    playlistId: 99,
    trackIds: [1],
  });
  expect(result).toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(store.getters['library/previewReady']).toBe(true);
  expect(store.getters['playlistDetail/current'].playlist.trackCount).toBe(749);
  expect(api.userLikedSongsIDs).toHaveBeenCalled();
});
test('a collection read without its playlist data marks confirmed removal synchronization incomplete', async () => {
  const { store, api } = setup();
  api.userPlaylist.mockResolvedValue({});
  await expect(
    store.dispatch('library/removePlaylistTracks', {
      playlistId: 20,
      trackIds: [1],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
});

test('confirmed removal from liked music preserves known removed IDs if refreshing IDs fails', async () => {
  const { store, api } = setup();
  api.userLikedSongsIDs = jest
    .fn()
    .mockResolvedValueOnce({ ids: [1, 2, 3] })
    .mockRejectedValueOnce(new Error('read failed'));
  api.userAccount = jest
    .fn()
    .mockResolvedValue({ code: 200, profile: { userId: 3 } });
  api.likedAlbums =
    api.likedArtists =
    api.likedMVs =
    api.cloudDisk =
      jest.fn().mockResolvedValue({ data: [] });
  api.userPlaylist.mockResolvedValue({ playlist: [{ id: 99 }] });
  await store.dispatch('library/loadApplication');
  const result = await store.dispatch('library/removePlaylistTracks', {
    playlistId: 99,
    trackIds: [1, 3],
  });
  expect(result.synchronization).toBe('incomplete');
  expect(store.getters['library/collections'].songs).toEqual([2]);
});

test('missing preview metadata keeps confirmed removal but marks synchronization incomplete', async () => {
  const { store, api } = setup();
  api.getPlaylistDetail.mockResolvedValue(undefined);
  api.userPlaylist.mockResolvedValue({ playlist: [{ id: 99 }] });
  api.userLikedSongsIDs = jest.fn().mockResolvedValue({ ids: [2] });
  await expect(
    store.dispatch('library/removePlaylistTracks', {
      playlistId: 99,
      trackIds: [1],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(store.getters['library/previewReady']).toBe(false);
});
