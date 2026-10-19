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

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('successful account replacement retires old details before the new profile arrives', async () => {
  const { libraryApi } = require('@/application/library');
  const auth = require('@/api/auth');
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
    credentials: { get: () => 'token', set() {}, remove() {} },
    session: { auth },
    library: { api: libraryApi },
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
  const profile = deferred();
  const profileStarted = deferred();
  const details = deferred();
  const detailsStarted = deferred();
  const artists = deferred();
  request.defaults.adapter = async config => {
    let data;
    if (config.url === '/login/cellphone')
      data = { code: 200, cookie: 'MUSIC_U=next' };
    else if (config.url === '/user/account') {
      profileStarted.resolve();
      data = await profile.promise;
    } else if (config.url === '/song/detail') {
      detailsStarted.resolve();
      data = await details.promise;
    } else if (config.url === '/search')
      data =
        config.params.type === 100
          ? await artists.promise
          : { result: { songs: [{ id: 70 }] } };
    else data = { code: 200, data: [], ids: [], playlist: [] };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const query = createMusicSearch(store);
  const publicQuery = createMusicSearch(store);
  const loading = query.replace({ keywords: 'account A', category: 'tracks' });
  const publicLoading = publicQuery.replace({
    keywords: 'public',
    category: 'artists',
  });
  await detailsStarted.promise;
  const login = store.dispatch('session/loginWithPassword', {
    mode: 'phone',
    countryCode: '+86',
    phone: '123',
    password: 'example',
  });
  await profileStarted.promise;
  details.resolve({ songs: [{ id: 70, fee: 1 }], privileges: [] });
  artists.resolve({ result: { artists: [{ id: 8 }] } });
  await Promise.all([loading, publicLoading]);
  expect(store.getters['library/user'].userId).toBe(1);
  expect(query.state.results.tracks).toEqual([]);
  expect(query.state.loading).toBe(false);
  expect(publicQuery.state.results.artists).toEqual([{ id: 8 }]);
  profile.resolve({ code: 200, profile: { userId: 2, vipType: 11 } });
  await login;
  query.dispose();
  publicQuery.dispose();
});

test.each(['search', 'details', 'public'])(
  'late 301 from old %s cannot invalidate the replacement account',
  async stage => {
    const { libraryApi } = require('@/application/library');
    const auth = require('@/api/auth');
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
      credentials: { get: () => 'token', set() {}, remove() {} },
      session: { auth },
      library: { api: libraryApi },
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
    let invalidations = 0;
    configureRequest({
      getSettings: () => ({}),
      getCookie: () => null,
      onSessionInvalid: () => {
        invalidations++;
        return store.dispatch('session/invalidate');
      },
      environment: { baseURL: '', configure: config => config },
    });
    const pending = deferred();
    const started = deferred();
    const profile = deferred();
    const profileStarted = deferred();
    request.defaults.adapter = async config => {
      let data;
      if (config.url === '/login/cellphone')
        data = { code: 200, cookie: 'MUSIC_U=B' };
      else if (config.url === '/user/account') {
        profileStarted.resolve();
        data = await profile.promise;
      } else if (
        config.url === '/song/detail' ||
        (config.url === '/search' && stage !== 'details')
      ) {
        started.resolve();
        await pending.promise;
        throw {
          config,
          response: {
            config,
            status: 401,
            data: { code: 301, msg: '需要登录' },
          },
        };
      } else if (config.url === '/search')
        data = { result: { songs: [{ id: 71 }] } };
      else data = { code: 200, data: [], ids: [], playlist: [] };
      return { data, status: 200, statusText: 'OK', headers: {}, config };
    };
    const query = createMusicSearch(store);
    const loading = query.replace({
      keywords: 'old',
      category: stage === 'public' ? 'artists' : 'tracks',
    });
    await started.promise;
    const login = store.dispatch('session/loginWithPassword', {
      mode: 'phone',
      countryCode: '+86',
      phone: '123',
      password: 'example',
    });
    await profileStarted.promise;
    pending.resolve();
    await loading;
    expect(invalidations).toBe(0);
    expect(store.getters['session/hasAccount']).toBe(true);
    expect(query.state.loading).toBe(false);
    profile.resolve({ code: 200, profile: { userId: 2 } });
    await login;
    query.dispose();
  }
);
