import 'fake-indexeddb/auto';
import { createStore } from '@/store';
import { configureMusicData } from '@/application/musicData';
import { configureRequest } from '@/utils/request';
import request from '@/utils/request';
import { getTrackDetail, getMP3 } from '@/api/track';
import { getTrackCache } from '@/utils/db';
import { createAudioResources } from '@/playback/audioResources';
import { startApplication } from '@/application/startup';

function fixture(settings = {}) {
  const saved = new Map([
    [
      'settings',
      JSON.stringify({
        musicQuality: 192000,
        cacheLimit: false,
        automaticallyCacheSongs: false,
        ...settings,
      }),
    ],
    [
      'data',
      JSON.stringify({
        loginMode: 'account',
        user: { userId: 1, vipType: 11 },
      }),
    ],
  ]);
  const storage = {
    getItem: key => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
  };
  let token = 'test';
  const store = createStore({
    storage,
    language: 'en',
    credentials: {
      get: () => token,
      set() {
        token = 'test';
      },
      remove() {
        token = null;
      },
    },
  });
  return store;
}
const readers = store => ({
  getSettings: () => store.getters['preferences/settings'],
  getIdentity: () => ({
    hasAccount: store.getters['session/hasAccount'],
    vipType: store.getters['library/user'].vipType,
  }),
});
let requests;
beforeEach(() => {
  requests = [];
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: '', configure: config => config },
  });
  request.defaults.adapter = async config => {
    requests.push(config);
    const data =
      config.url === '/song/url'
        ? {
            data: [
              {
                url: 'https://audio.test/song',
                freeTrialInfo: null,
                br: config.params.br,
              },
            ],
          }
        : { songs: [{ id: 91, fee: 1 }], privileges: [{ id: 91 }] };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
});

test('metadata identity follows the configured store and public session operations', async () => {
  const bound = fixture();
  const reads = readers(bound);
  configureMusicData({
    ...reads,
    isElectron: true,
    download: async () => new ArrayBuffer(2),
  });
  await getTrackCache().clearDB();
  const unrelated = fixture();
  await unrelated.dispatch('session/logout');
  expect((await getTrackDetail(91)).songs[0].playable).toBe(true);
  await bound.dispatch('session/logout');
  expect((await getTrackDetail(91)).songs[0].playable).toBe(false);
});

test('one settings reader controls audio quality and transactional cache limits', async () => {
  const bound = fixture();
  const reads = readers(bound);
  configureMusicData({
    ...reads,
    isElectron: true,
    download: async () => new ArrayBuffer(2),
  });
  const cache = getTrackCache();
  await cache.clearDB();
  const resources = createAudioResources({
    cache,
    getMP3,
    settings: reads.getSettings,
    hasAccount: () => reads.getIdentity().hasAccount,
  });
  fixture({ musicQuality: 999999, cacheLimit: 0 });
  await resources.resolve({ id: 1 });
  expect(
    requests.filter(item => item.url === '/song/url').pop().params.br
  ).toBe(192000);
  await bound.dispatch('preferences/setMusicQuality', 'flac');
  await resources.resolve({ id: 2 });
  expect(
    requests.filter(item => item.url === '/song/url').pop().params.br
  ).toBe('350000');
  await cache.cacheTrackSource({ id: 1 }, 'audio', 192000);
  expect((await cache.countDBSize()).bytes).toBe(2);
  await bound.dispatch('preferences/setPreference', {
    key: 'cacheLimit',
    value: 0,
  });
  await cache.cacheTrackSource({ id: 2 }, 'audio', 192000);
  expect(await cache.countDBSize()).toEqual({ bytes: 0, length: 0 });
});

test('application binds data and initializes cache before the first player request or restore', async () => {
  const bound = fixture();
  const events = [];
  let appReads;
  await startApplication({
    createStore: () => bound,
    initializeLocale: () => ({}),
    initializeAppearance() {},
    configureRequest: () => events.push('request'),
    initializeDependencies: async (store, reads) => {
      expect(store).toBe(bound);
      appReads = reads;
      configureMusicData({
        ...reads,
        isElectron: true,
        download: async () => new ArrayBuffer(2),
      });
      await getTrackCache().initializeTrackCache();
      events.push('data');
    },
    createPlayer: ({ getSettings, getIdentity }) => {
      expect(getSettings).toBe(appReads.getSettings);
      expect(getIdentity).toBe(appReads.getIdentity);
      events.push('player');
      return {
        restoreSaved: async () => {
          await getMP3(1, { quality: getSettings().musicQuality });
          events.push('restore');
        },
      };
    },
    mount: () => events.push('mount'),
  });
  expect(events.indexOf('request')).toBeLessThan(events.indexOf('data'));
  expect(events.indexOf('data')).toBeLessThan(events.indexOf('player'));
  expect(events.indexOf('player')).toBeLessThan(events.indexOf('restore'));
});
