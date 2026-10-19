import { startApplication } from '@/application/startup';
import { initializeLocale } from '@/locale';
import { initializeAppearance } from '@/utils/appearance';
import request, { configureRequest } from '@/utils/request';

let store;
let registrationRequests;

beforeAll(() => {
  global.indexedDB = { deleteDatabase() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  document.head.innerHTML = '<meta name="theme-color" content="#fff">';
  localStorage.setItem('appVersion', '0.4.11');
  localStorage.setItem(
    'settings',
    JSON.stringify({
      lang: 'zh-TW',
      appearance: 'dark',
      enableRealIP: true,
      realIP: '203.0.113.8',
      proxyConfig: { protocol: 'HTTP', server: 'localhost', port: 8080 },
    })
  );
  request.defaults.baseURL = '/api';
  registrationRequests = jest.fn();
  request.defaults.adapter = registrationRequests;
  store = require('@/store').default;
});

test('registering the base store leaves network and player initialization to application startup', async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(registrationRequests).not.toHaveBeenCalled();
  expect(store.state.player).toEqual({});
});

test('stored language and request effects are available before the first player request', async () => {
  let invalidSession = false;
  let firstConfiguration;
  request.defaults.adapter = config => {
    firstConfiguration = config;
    return Promise.reject({
      response: { data: { code: 301, msg: '需要登录' } },
    });
  };
  let firstRequest;
  const app = startApplication({
    store,
    initializeLocale,
    configureRequest,
    getCookie: () => null,
    onSessionInvalid: () => {
      invalidSession = true;
    },
    initializeAppearance,
    createPlayer() {
      firstRequest = request.get('/song/detail');
      return { enabled: true };
    },
    mount({ i18n, store: mountedStore }) {
      return { language: i18n.locale, player: mountedStore.state.player };
    },
  });
  await firstRequest;
  expect(app.language).toBe('zh-TW');
  expect(app.player.enabled).toBe(true);
  expect(document.body.getAttribute('data-theme')).toBe('dark');
  expect(firstConfiguration.params).toEqual({
    realIP: '203.0.113.8',
    proxy: 'HTTP://localhost:8080',
  });
  expect(invalidSession).toBe(true);
});

test('the real player starts its first request using the restored settings', async () => {
  jest.spyOn(global, 'setInterval').mockReturnValue(0);
  const { createPlayer } = require('@/application/player');
  let observeRequest;
  const observed = new Promise(resolve => {
    observeRequest = resolve;
  });
  request.defaults.adapter = config => {
    observeRequest(config);
    return Promise.resolve({
      config,
      status: 200,
      data: { data: [{ id: 1 }, { id: 2 }] },
    });
  };
  const player = startApplication({
    store,
    initializeLocale,
    initializeAppearance,
    configureRequest,
    getCookie: () => null,
    onSessionInvalid() {},
    createPlayer,
    mount: ({ store: mountedStore }) => mountedStore.state.player,
  });
  const config = await observed;
  expect(config.url).toBe('/personal_fm');
  expect(config.params.realIP).toBe('203.0.113.8');
  expect(config.params.proxy).toBe('HTTP://localhost:8080');
  expect(player.currentTrackID).toBe(86827685);
});
