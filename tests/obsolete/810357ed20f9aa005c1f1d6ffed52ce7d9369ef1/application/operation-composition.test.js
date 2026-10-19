/* eslint-env jest */
import { createStore } from '@/store';

test('真实集合、详情加载分页和二维码展示不保存设置或身份投影', async () => {
  const values = {
    data: JSON.stringify({
      loginMode: 'account',
      user: { userId: 3 },
      likedSongPlaylistID: 99,
    }),
  };
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const ids = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
  const store = createStore({
    storage,
    credentials: { get: () => 'credential' },
    library: {
      api: {
        userPlaylist: async () => ({ playlist: [{ id: 99 }, { id: 20 }] }),
        getPlaylistDetail: async id => ({
          playlist: { id, trackIds: ids, tracks: [], trackCount: 250 },
        }),
        getTrackDetail: async batch => ({
          songs: batch.split(',').map(id => ({ id: Number(id) })),
        }),
      },
    },
    session: {
      auth: {
        loginQrCodeKey: async () => ({ code: 200, data: { unikey: 'qr' } }),
      },
      time: { schedule: () => 1, cancel: () => {} },
    },
  });
  await store.dispatch('preferences/applyRestored');
  storage.setItem.mockClear();
  await store.dispatch('library/refreshPlaylists');
  expect(store.getters['library/collections'].playlists).toEqual([
    { id: 99 },
    { id: 20 },
  ]);
  const opening = store.dispatch('playlistDetail/open', 20);
  expect(store.getters['playlistDetail/current'].loading).toBe(true);
  await opening;
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(store.getters['playlistDetail/current'].tracks).toHaveLength(200);
  await store.dispatch('session/startQrLogin');
  expect(store.getters['session/qr'].url).toContain('codekey=qr');
  await store.dispatch('session/stopQrLogin');
  await store.dispatch('playlistDetail/close');
  expect(storage.setItem).not.toHaveBeenCalled();
});
