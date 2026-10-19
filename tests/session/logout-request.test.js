/* eslint-env jest */
import Vue from 'vue';
import request, { configureRequest } from '@/utils/request';
import { createCredentials } from '@/application/credentials';
import { logout } from '@/api/auth';
import { createStore } from '@/store';

function account({ session = {}, cookies } = {}) {
  localStorage.setItem(
    'data',
    JSON.stringify({
      loginMode: 'account',
      user: { userId: 7 },
      likedSongPlaylistID: 12,
    })
  );
  localStorage.setItem('cookie-MUSIC_U', 'account-token');
  localStorage.setItem('cookie-__csrf', 'csrf-token');
  localStorage.setItem('lastfm', JSON.stringify({ key: 'lastfm-token' }));
  localStorage.setItem('player', JSON.stringify({ _list: [123] }));
  localStorage.setItem('playerCurrentTrackTime', '42');
  const credentials = createCredentials({
    cookies: cookies || { get: () => undefined, remove() {} },
  });
  const destinations = [];
  const notifications = [];
  const store = createStore({
    credentials,
    session: {
      auth: { logout },
      navigate: reason => destinations.push(reason),
      notify: message => notifications.push(message),
      ...session,
    },
  });
  configureRequest({
    getSettings: () => store.getters['preferences/settings'],
    getCookie: key => credentials.get(key),
    onSessionInvalid: () => store.dispatch('session/invalidate'),
  });
  request.defaults.baseURL = 'https://music.example/api';
  return { store, credentials, destinations, notifications };
}

beforeEach(() => localStorage.clear());

test('active logout removes account identity and credentials while preserving independent data', async () => {
  const { store, credentials, destinations } = account();
  const view = new Vue({
    store,
    computed: {
      hasAccount() {
        return this.$store.getters['session/hasAccount'];
      },
    },
  });
  let remoteConfig;
  request.defaults.adapter = config => {
    remoteConfig = config;
    return Promise.resolve({ data: { code: 200 }, config, status: 200 });
  };
  expect(view.hasAccount).toBe(true);
  await store.dispatch('session/logout');
  expect(remoteConfig.url).toBe('/logout');
  expect(remoteConfig.params.cookie).toBe('MUSIC_U=account-token;');
  expect(view.hasAccount).toBe(false);
  expect(store.getters['session/hasLibraryIdentity']).toBe(false);
  expect(credentials.get('MUSIC_U')).toBeNull();
  expect(credentials.get('__csrf')).toBeNull();
  expect(store.getters['library/user']).toEqual({});
  expect(store.getters['library/likedSongPlaylistID']).toBe(0);
  expect(destinations).toEqual(['logout']);
  expect(JSON.parse(localStorage.getItem('lastfm'))).toEqual({
    key: 'lastfm-token',
  });
  expect(JSON.parse(localStorage.getItem('player'))).toEqual({ _list: [123] });
  expect(localStorage.getItem('playerCurrentTrackTime')).toBe('42');
  view.$destroy();
});

test('a rejected account session clears identity once without requesting remote logout', async () => {
  const { store, credentials, destinations, notifications } = account();
  const requests = [];
  request.defaults.adapter = config => {
    requests.push(config.url);
    return Promise.reject({
      response: { data: { code: 301, msg: '需要登录' } },
    });
  };
  expect(await request({ url: '/user/account' })).toBeUndefined();
  expect(requests).toEqual(['/user/account']);
  expect(store.getters['session/hasAccount']).toBe(false);
  expect(store.getters['library/user']).toEqual({});
  expect(store.getters['library/likedSongPlaylistID']).toBe(0);
  expect(credentials.get('MUSIC_U')).toBeNull();
  expect(credentials.get('__csrf')).toBeNull();
  expect(destinations).toEqual(['invalidated']);
  expect(notifications).toEqual(['登录状态已失效，请重新登录']);
  expect(JSON.parse(localStorage.getItem('lastfm'))).toEqual({
    key: 'lastfm-token',
  });
});

test('active logout cannot recursively invalidate when its remote endpoint rejects the session', async () => {
  const { store, destinations, notifications } = account();
  request.defaults.adapter = config =>
    Promise.reject({
      config,
      response: { data: { code: 301, msg: '需要登录' } },
    });
  await store.dispatch('session/logout');
  expect(store.getters['session/hasAccount']).toBe(false);
  expect(destinations).toEqual(['logout']);
  expect(notifications).toEqual([]);
});

test.each([false, true])(
  'application effects direct logout home and invalidation to the environment login page (Electron: %s)',
  async isElectron => {
    const { createSessionEffects } = require('@/application/sessionEffects');
    const pages = [];
    const messages = [];
    const effects = createSessionEffects({
      isElectron,
      router: {
        currentRoute: { name: 'library' },
        push: page => pages.push(page),
      },
      notify: message => messages.push(message),
    });
    const { store } = account({ session: effects });
    request.defaults.adapter = config =>
      Promise.resolve({ data: { code: 200 }, config, status: 200 });
    await store.dispatch('session/logout');
    await store.dispatch('session/invalidate');
    expect(pages).toEqual([
      { name: 'home' },
      { name: isElectron ? 'loginAccount' : 'login' },
    ]);
    expect(messages).toEqual(['登录状态已失效，请重新登录']);
  }
);

test.each([
  { message: 'Network Error' },
  { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' },
  { response: { data: { code: 500, msg: 'Server Error' } } },
  { response: { data: null } },
])(
  'ordinary request failures preserve the account and keep the existing undefined result',
  async failure => {
    const { store, credentials, destinations, notifications } = account();
    request.defaults.adapter = () => Promise.reject(failure);
    expect(await request({ url: '/user/account' })).toBeUndefined();
    expect(store.getters['session/hasAccount']).toBe(true);
    expect(store.getters['library/user']).toEqual({ userId: 7 });
    expect(credentials.get('MUSIC_U')).toBe('account-token');
    expect(destinations).toEqual([]);
    expect(notifications).toEqual([]);
  }
);

test('active logout completes local cleanup even if the remote transport rejects', async () => {
  const { store, destinations } = account({
    session: { auth: { logout: () => Promise.reject(new Error('Offline')) } },
  });
  await store.dispatch('session/logout');
  expect(store.getters['session/hasLibraryIdentity']).toBe(false);
  expect(destinations).toEqual(['logout']);
});

test('logout exits a public library identity without resetting preferences or in-memory collections', async () => {
  const { store } = account({
    session: { auth: { logout: () => Promise.resolve() } },
  });
  await store.dispatch('session/selectPublicIdentity', { userId: 99 });
  store.commit('library/setCollection', { name: 'songs', data: [123] });
  store.commit('preferences/updateSettings', {
    key: 'futurePreference',
    value: 'retained',
  });
  await store.dispatch('session/logout');
  expect(store.getters['session/hasLibraryIdentity']).toBe(false);
  expect(store.getters['library/user']).toEqual({});
  expect(store.getters['library/collections'].songs).toEqual([123]);
  expect(store.getters['preferences/settings'].futurePreference).toBe(
    'retained'
  );
});

test('the credential adapter restores cookie storage, preserves equals signs and removes both browser and stored credentials', async () => {
  const credentials = createCredentials();
  credentials.set('MUSIC_U=token==; path=/;;__csrf=csrf-value; path=/');
  expect(document.cookie).toContain('MUSIC_U=token==');
  expect(credentials.get('MUSIC_U')).toBe('token==');
  expect(localStorage.getItem('cookie-MUSIC_U')).toBe('token==');
  localStorage.setItem('data', JSON.stringify({ loginMode: 'account' }));
  const store = createStore({ credentials });
  await store.dispatch('session/restore');
  expect(store.getters['session/hasAccount']).toBe(true);
  await store.dispatch('session/logout');
  expect(document.cookie).not.toContain('MUSIC_U=');
  expect(document.cookie).not.toContain('__csrf=');
  expect(credentials.get('MUSIC_U')).toBeNull();
  expect(credentials.get('__csrf')).toBeNull();
  expect(store.getters['session/hasAccount']).toBe(false);
});

test('active logout clears local identity and navigates while remote logout is still pending', async () => {
  const { store, credentials, destinations } = account();
  let finishRemote;
  let remoteCredential;
  request.defaults.adapter = config => {
    remoteCredential = config.params.cookie;
    return new Promise(resolve => {
      finishRemote = () =>
        resolve({ data: { code: 200 }, config, status: 200 });
    });
  };
  let finishedLocal = false;
  const localExit = store.dispatch('session/logout').then(() => {
    finishedLocal = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    expect(remoteCredential).toBe('MUSIC_U=account-token;');
    expect(finishedLocal).toBe(true);
    expect(store.getters['session/hasAccount']).toBe(false);
    expect(credentials.get('MUSIC_U')).toBeNull();
    expect(destinations).toEqual(['logout']);
  } finally {
    finishRemote();
    await localExit;
  }
});
