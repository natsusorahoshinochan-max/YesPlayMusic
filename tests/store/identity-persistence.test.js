/* eslint-env jest */
global.indexedDB = { deleteDatabase() {} };
const { createStore } = require('@/store');

beforeEach(() => localStorage.clear());

test('restores identity and preferences from the existing schema and keeps unknown fields when saving', async () => {
  localStorage.setItem(
    'data',
    JSON.stringify({
      loginMode: 'account',
      user: { userId: 7 },
      likedSongPlaylistID: 19,
      libraryPlaylistFilter: 'mine',
      futureData: { value: 4 },
    })
  );
  localStorage.setItem(
    'settings',
    JSON.stringify({ lang: 'zh-TW', futureSetting: { enabled: true } })
  );
  localStorage.setItem('lastfm', JSON.stringify({ key: 'independent' }));
  localStorage.setItem(
    'player',
    JSON.stringify({ _list: [123], _currentTrack: { id: 123 } })
  );
  localStorage.setItem('playerCurrentTrackTime', '42');
  const credentials = { get: name => (name === 'MUSIC_U' ? 'token' : null) };
  const store = createStore({ credentials });
  await store.dispatch('session/restore');
  expect(store.getters['session/hasAccount']).toBe(true);
  expect(store.getters['library/user']).toEqual({ userId: 7 });
  expect(store.getters['library/likedSongPlaylistID']).toBe(19);
  expect(store.getters['preferences/libraryPlaylistFilter']).toBe('mine');
  store.commit('library/setUser', { userId: 8 });
  store.commit('preferences/updateSettings', {
    key: 'musicQuality',
    value: 999,
  });
  expect(JSON.parse(localStorage.getItem('data'))).toMatchObject({
    user: { userId: 8 },
    futureData: { value: 4 },
    libraryPlaylistFilter: 'mine',
    loginMode: 'account',
  });
  expect(JSON.parse(localStorage.getItem('settings'))).toMatchObject({
    lang: 'zh-TW',
    musicQuality: 999,
    futureSetting: { enabled: true },
  });
  expect(localStorage.getItem('lastfm')).toBe('{"key":"independent"}');
  expect(JSON.parse(localStorage.getItem('player'))._list).toEqual([123]);
  expect(localStorage.getItem('playerCurrentTrackTime')).toBe('42');
});

test('missing credentials never restore an account session and stores have isolated state', async () => {
  localStorage.setItem(
    'data',
    JSON.stringify({ loginMode: 'account', user: { userId: 7 } })
  );
  const accountWithoutCredentials = createStore();
  await accountWithoutCredentials.dispatch('session/restore');
  expect(accountWithoutCredentials.getters['session/hasAccount']).toBe(false);
  expect(accountWithoutCredentials.getters['session/hasLibraryIdentity']).toBe(
    false
  );
  const publicLibrary = createStore({
    library: { api: { userPlaylist: () => Promise.resolve({ playlist: [] }) } },
  });
  await publicLibrary.dispatch('session/selectPublicIdentity', { userId: 22 });
  expect(publicLibrary.getters['session/hasAccount']).toBe(false);
  expect(publicLibrary.getters['session/hasLibraryIdentity']).toBe(true);
  expect(accountWithoutCredentials.getters['library/user'].userId).toBe(7);
  publicLibrary.commit('updateToast', { show: true });
  expect(accountWithoutCredentials.state.toast.show).toBe(false);
});

test('restored credentials and daily refresh share reactive session state with ordinary JavaScript callers', async () => {
  const Vue = require('vue');
  const { createCredentials } = require('@/application/credentials');
  const { isTrackPlayable } = require('@/utils/common');
  localStorage.setItem(
    'data',
    JSON.stringify({
      loginMode: 'account',
      user: { userId: 7, vipType: 11 },
      lastRefreshCookieDate: 0,
    })
  );
  localStorage.setItem('cookie-MUSIC_U', 'stored-token=');
  const refreshCookie = jest.fn().mockResolvedValue({ code: 200 });
  const credentials = createCredentials({
    cookies: { get: () => undefined, remove() {} },
  });
  const store = createStore({
    credentials,
    session: { auth: { refreshCookie }, now: () => new Date(2026, 9, 19) },
  });
  const view = new Vue({
    store,
    computed: {
      canUseAccount() {
        return this.$store.getters['session/hasAccount'];
      },
    },
  });
  expect(view.canUseAccount).toBe(true);
  expect(isTrackPlayable({ fee: 1 }).playable).toBe(true);
  await store.dispatch('session/refreshDaily');
  await store.dispatch('session/refreshDaily');
  expect(refreshCookie).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('data')).lastRefreshCookieDate).toBe(
    19
  );
  credentials.remove('MUSIC_U');
  await store.dispatch('session/restore');
  expect(view.canUseAccount).toBe(false);
  expect(isTrackPlayable({ fee: 1 }).playable).toBe(false);
  view.$destroy();
});

test('retains the supported player migration independently of the data and settings schema', () => {
  localStorage.setItem('appVersion', '"0.2.5"');
  localStorage.setItem(
    'player',
    JSON.stringify({ incompatibleLegacyQueue: [123] })
  );
  createStore();
  expect(JSON.parse(localStorage.getItem('player'))).toEqual({});
});

test('Electron receives the restored preferences and subsequent preference changes', () => {
  const environment = process.env;
  const requireDesktop = window.require;
  const send = jest.fn();
  try {
    process.env = { ...environment, IS_ELECTRON: true };
    window.require = () => ({ ipcRenderer: { send } });
    localStorage.setItem(
      'settings',
      JSON.stringify({ appearance: 'dark', customDesktopSetting: true })
    );
    const store = createStore();
    expect(send).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        appearance: 'dark',
        customDesktopSetting: true,
      })
    );
    send.mockClear();
    store.commit('preferences/updateSettings', {
      key: 'appearance',
      value: 'light',
    });
    expect(send).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ appearance: 'light' })
    );
  } finally {
    process.env = environment;
    window.require = requireDesktop;
  }
});
