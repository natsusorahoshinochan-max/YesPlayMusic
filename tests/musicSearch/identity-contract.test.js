import 'fake-indexeddb/auto';
import { createStore } from '@/store';
import { createMusicSearch } from '@/application/musicSearch';
import { configureMusicData } from '@/application/musicData';
import { configureRequest } from '@/utils/request';
import request from '@/utils/request';
import { getTrackCache } from '@/utils/db';

test('real identity changes retire track details while public reads retain query ownership', async () => {
  const store = createStore({
    storage: {
      getItem: key =>
        key === 'data'
          ? JSON.stringify({
              loginMode: 'account',
              user: { userId: 1, vipType: 11 },
            })
          : null,
      setItem() {},
    },
    credentials: { get: () => 'token', remove() {} },
    language: 'en',
  });
  configureMusicData({
    getSettings: () => ({ cacheLimit: false }),
    getIdentity: () => ({
      hasAccount: store.getters['session/hasAccount'],
      vipType: store.getters['library/user'].vipType,
    }),
  });
  await getTrackCache().clearDB();
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: '', configure: config => config },
  });
  let detail;
  let detailsStarted;
  const started = new Promise(resolve => {
    detailsStarted = resolve;
  });
  let artist;
  request.defaults.adapter = async config => {
    const data =
      config.url === '/song/detail'
        ? await new Promise(resolve => {
            detail = resolve;
            detailsStarted();
          })
        : config.params.type === 100
        ? await new Promise(resolve => {
            artist = resolve;
          })
        : { result: { songs: [{ id: 60 }] } };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const tracks = createMusicSearch(store);
  const publicQuery = createMusicSearch(store);
  const a = tracks.replace({ keywords: 'tracks', category: 'tracks' });
  const b = publicQuery.replace({ keywords: 'artists', category: 'artists' });
  await started;
  await store.dispatch('session/logout');
  expect(tracks.state.loading).toBe(false);
  detail({ songs: [{ id: 60, fee: 1 }], privileges: [] });
  artist({ result: { artists: [{ id: 3 }] } });
  await Promise.all([a, b]);
  expect(tracks.state.results.tracks).toEqual([]);
  expect(publicQuery.state.results.artists).toEqual([{ id: 3 }]);
  tracks.dispose();
  publicQuery.dispose();
});
