import 'fake-indexeddb/auto';
import axios from 'axios';
import { configureMusicData } from '@/application/musicData';
import { shallowMount } from '@vue/test-utils';
import Callback from '@/views/lastfmCallback.vue';
jest.mock('axios', () => jest.fn());
import { createStore } from '@/store';

function storageWith(session) {
  const values = new Map(session ? [['lastfm', JSON.stringify(session)]] : []);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('each renderer restores its independent authorization and complete operations save and disconnect it', async () => {
  const storage = storageWith({ key: 'saved', name: 'Listener', future: 7 });
  const store = createStore({ storage });
  const other = createStore({ storage: storageWith() });
  expect(store.getters['lastfm/authorization']).toEqual({
    key: 'saved',
    name: 'Listener',
    future: 7,
  });
  expect(other.getters['lastfm/authorization']).toEqual({});
  await store.dispatch('lastfm/disconnect');
  expect(store.getters['lastfm/authorization']).toEqual({});
  expect(storage.getItem('lastfm')).toBeNull();
});

test('callback exchanges its token through the authorization owner and preserves the saved representation', async () => {
  history.replaceState({}, '', '/lastfm/callback?token=callback-token');
  const authorization = { key: 'new-session', name: 'Listener', subscriber: 1 };
  axios.mockResolvedValue({ data: { session: authorization } });
  const storage = storageWith();
  const store = createStore({ storage });
  const callback = shallowMount(Callback, {
    mocks: { $store: store },
    stubs: ['svg-icon'],
  });
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  expect(callback.text()).toContain('已成功连接到 Last.fm');
  expect(store.getters['lastfm/authorization']).toEqual(authorization);
  expect(JSON.parse(storage.getItem('lastfm'))).toEqual(authorization);
  expect(axios.mock.calls[0][0].params.token).toBe('callback-token');
  callback.destroy();
  history.replaceState({}, '', '/');
});

test('authorization exchange adopts the saved callback result once and releases polling and listeners', async () => {
  jest.useFakeTimers();
  const opened = jest.spyOn(window, 'open').mockImplementation(() => ({}));
  const storage = storageWith();
  const first = createStore({ storage });
  await first.dispatch('lastfm/connect');
  expect(opened).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(1);
  storage.setItem(
    'lastfm',
    JSON.stringify({ key: 'exchanged', name: 'Other window' })
  );
  jest.advanceTimersByTime(1000);
  expect(first.getters['lastfm/authorization'].key).toBe('exchanged');
  expect(jest.getTimerCount()).toBe(0);
  storage.setItem('lastfm', JSON.stringify({ key: 'later' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'lastfm' }));
  expect(first.getters['lastfm/authorization'].key).toBe('exchanged');
  await first.dispatch('lastfm/disconnect');
  await first.dispatch('lastfm/connect');
  expect(jest.getTimerCount()).toBe(1);
  await first.dispatch('lastfm/stopConnecting');
  expect(jest.getTimerCount()).toBe(0);
  await first.dispatch('lastfm/connect');
  window.dispatchEvent(new Event('beforeunload'));
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('effective playback events sign with captured owner credentials despite divergent saved credentials and keep one report claim', async () => {
  const { createPlayback } = require('@/playback');
  const {
    createPlaybackReporting,
  } = require('@/application/playbackReporting');
  const { trackScrobble, trackUpdateNowPlaying } = require('@/api/lastfm');
  const storage = storageWith({ key: 'owner-session' });
  const store = createStore({ storage });
  // Another window changes disk without participating in this renderer's exchange.
  localStorage.setItem('lastfm', JSON.stringify({ key: 'disk-session' }));
  const neteaseReports = [];
  const report = createPlaybackReporting({
    neteaseScrobble: params => neteaseReports.push(params),
    lastfmScrobble: trackScrobble,
    lastfmNowPlaying: trackUpdateNowPlaying,
    getLastfmAuthorization: () => store.getters['lastfm/authorization'],
    now: () => 1000000,
  });
  const handles = [];
  const playback = createPlayback({
    getTrack: async id => ({
      id,
      name: 'Song',
      dt: 200000,
      ar: [{ name: 'Artist' }],
      al: { name: 'Album' },
      no: 3,
    }),
    resources: {
      resolve: async () => ({ kind: 'url', url: 'https://audio.test/song' }),
    },
    audio: {
      prepare: async (resource, events) => {
        let position = 0;
        const handle = {
          play: () => events.onPlay(),
          pause: () => events.onPause(),
          position: () => position,
          seek: value => {
            position = value;
          },
          dispose() {},
          setVolume() {},
          applyOutputDevice() {},
          events,
        };
        handles.push(handle);
        return handle;
      },
    },
    onPlaybackEvent: report,
    setInterval: () => 0,
    clearInterval() {},
  });
  axios.mockResolvedValue({ data: {} });
  await playback.playTracks([1, 2]);
  expect(axios.mock.calls[0][0].params).toMatchObject({
    method: 'track.updateNowPlaying',
    sk: 'owner-session',
    api_sig: 'ce7ff95272a6276fc85cc8616811d499',
  });
  playback.seek(120);
  handles[0].events.onEnd();
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  const scrobbles = axios.mock.calls
    .map(([config]) => config.params)
    .filter(params => params.method === 'track.scrobble');
  expect(scrobbles).toHaveLength(1);
  expect(scrobbles[0]).toMatchObject({
    sk: 'owner-session',
    duration: 200,
    timestamp: 800,
  });
  expect(neteaseReports).toHaveLength(1);
  await store.dispatch('lastfm/disconnect');
  const sent = axios.mock.calls.length;
  playback.pause();
  playback.play();
  expect(axios).toHaveBeenCalledTimes(sent);
  playback.dispose();
});

test('settings connects and disconnects through complete operations and releases exchange when leaving', async () => {
  jest.useFakeTimers();
  jest.spyOn(window, 'open').mockImplementation(() => ({}));
  const Settings = require('@/views/settings.vue').default;
  const storage = storageWith();
  const store = createStore({ storage });
  configureMusicData({
    getSettings: () => store.getters['preferences/settings'],
    getIdentity: () => ({ hasAccount: false }),
  });
  const settings = shallowMount(Settings, {
    mocks: { $store: store, $t: key => key, $i18n: { locale: 'en' } },
    stubs: ['svg-icon'],
  });
  const connect = settings
    .findAll('button')
    .wrappers.find(button => button.text() === '授权连接');
  expect(connect).toBeDefined();
  await connect.trigger('click');
  expect(jest.getTimerCount()).toBe(1);
  storage.setItem(
    'lastfm',
    JSON.stringify({ key: 'settings-session', name: 'Listener' })
  );
  window.dispatchEvent(new StorageEvent('storage', { key: 'lastfm' }));
  await settings.vm.$nextTick();
  expect(settings.text()).toContain('已连接到 Last.fm (Listener)');
  const disconnect = settings
    .findAll('button')
    .wrappers.find(button => button.text() === '断开连接');
  await disconnect.trigger('click');
  expect(store.getters['lastfm/authorization']).toEqual({});
  expect(storage.getItem('lastfm')).toBeNull();
  await settings
    .findAll('button')
    .wrappers.find(button => button.text() === '授权连接')
    .trigger('click');
  settings.destroy();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
