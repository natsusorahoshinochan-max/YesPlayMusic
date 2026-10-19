import http from 'http';
import request, { configureRequest } from '@/utils/request';
import { createRequestEnvironment } from '@/application/requestEnvironment';
import { createStore } from '@/store';
import * as auth from '@/api/auth';
import { libraryApi } from '@/application/library';
import { createSessionEffects } from '@/application/sessionEffects';

let server, baseURL, respond, store, notices, router;
beforeAll(async () => {
  server = http.createServer((req, res) => respond(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
function reply(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://localhost',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.end(JSON.stringify(body));
}
beforeEach(async () => {
  notices = [];
  router = { currentRoute: { name: 'album', meta: {} }, push: jest.fn() };
  let token = 'A';
  store = createStore({
    storage: {
      getItem: key =>
        key === 'data' ? JSON.stringify({ loginMode: 'account' }) : null,
      setItem() {},
    },
    language: 'en',
    credentials: {
      get: () => token,
      set: value => {
        token = value;
      },
      remove: () => {
        token = '';
      },
    },
    library: { api: libraryApi },
    session: {
      auth,
      ...createSessionEffects({
        router,
        notify: value => notices.push(value),
        alert() {},
        isElectron: false,
      }),
    },
  });
  await store.dispatch('session/restore');
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => token,
    getSessionOwnership: () => store.getters['session/ownership'],
    onSessionInvalid: signal => store.dispatch('session/invalidate', signal),
    environment: createRequestEnvironment({ webBaseURL: baseURL }),
  });
});
test('public request rejects business failure with raw information, including HTTP 200 refusal', async () => {
  respond = (req, res) => reply(res, { code: 500, msg: 'refused' });
  await expect(request({ url: '/like' })).rejects.toMatchObject({
    category: 'business',
    data: { code: 500, msg: 'refused' },
    status: 200,
  });
  expect(store.getters['session/hasAccount']).toBe(true);
});

test('matching concurrent invalidations clear once and preserve the public route', async () => {
  const ownership = store.getters['session/ownership'];
  expect(ownership).toBeDefined();
  expect(Object.isFrozen(ownership)).toBe(true);
  respond = (req, res) => reply(res, { code: 301, msg: '需要登录' }, 401);
  const results = await Promise.allSettled([
    request({ url: '/like' }),
    request({ url: '/user/account' }),
  ]);
  expect(results.map(result => result.reason.category)).toEqual([
    'session-invalid',
    'session-invalid',
  ]);
  expect(store.getters['session/hasAccount']).toBe(false);
  expect(notices).toHaveLength(1);
  expect(router.push).not.toHaveBeenCalled();
});

test('late invalid response from the previous restored session cannot clear the current session', async () => {
  let release;
  const arrived = new Promise(resolve => {
    respond = (req, res) => {
      release = () => reply(res, { code: 301, msg: '需要登录' }, 401);
      resolve();
    };
  });
  const previous = store.getters['session/ownership'];
  const pending = request({ url: '/user/account' }).catch(error => error);
  await arrived;
  await store.dispatch('session/restore');
  expect(store.getters['session/ownership']).not.toBe(previous);
  release();
  expect((await pending).category).toBe('session-invalid');
  expect(store.getters['session/hasAccount']).toBe(true);
  expect(notices).toEqual([]);
});

test.each([
  ['/login', () => auth.loginWithEmail({ email: 'b@c.d' })],
  ['/login/qr/check', () => auth.loginQrCodeCheck('key')],
])(
  'authentication refusal at %s keeps the active account',
  async (path, operation) => {
    respond = (req, res) => reply(res, { code: 301, msg: '需要登录' }, 401);
    await expect(operation()).rejects.toMatchObject({
      category: 'business',
      url: path,
    });
    expect(store.getters['session/hasAccount']).toBe(true);
    expect(notices).toEqual([]);
  }
);

test.each([800, 801, 802, 803])(
  'QR authentication accepts normal protocol state %s',
  async code => {
    respond = (req, res) => reply(res, { code });
    await expect(auth.loginQrCodeCheck('key')).resolves.toEqual({ code });
  }
);

test.each([
  ['outage', false],
  ['timeout', true],
])(
  '%s rejects as network and keeps the active session',
  async (name, timeout) => {
    respond = (req, res) =>
      timeout
        ? setTimeout(() => reply(res, {}), 80)
        : reply(res, { message: 'offline' }, 503);
    await expect(
      request({ url: '/user/account', timeout: timeout ? 20 : 1000 })
    ).rejects.toMatchObject({ category: 'network' });
    expect(store.getters['session/hasAccount']).toBe(true);
    expect(notices).toEqual([]);
  }
);

test.each([
  ['library', { requireLogin: true }, 'login'],
  ['dailySongs', { requireAccountLogin: true }, 'loginAccount'],
])(
  'invalidated protected %s opens its login entrance once',
  async (name, meta, target) => {
    router.currentRoute = { name, meta };
    respond = (req, res) => reply(res, { code: 301, msg: '需要登录' });
    await expect(request({ url: '/user/account' })).rejects.toMatchObject({
      category: 'session-invalid',
    });
    expect(router.push).toHaveBeenCalledWith({ name: target });
    expect(router.push).toHaveBeenCalledTimes(1);
  }
);

test('request preparation failure remains an original programming error', async () => {
  const original = new TypeError('invalid proxy setting');
  configureRequest({
    getSettings: () => {
      throw original;
    },
    getCookie: () => '',
    onSessionInvalid() {},
  });
  await expect(request({ url: '/like' })).rejects.toBe(original);
});

test.each([
  ['network', 503, { message: 'offline' }, 'unconfirmed'],
  ['business', 200, { code: 502, msg: 'denied' }, 'rejected'],
])(
  'complete library write reduces %s using the public classifier',
  async (category, status, body, outcome) => {
    respond = (req, res) => reply(res, body, status);
    await expect(
      store.dispatch('library/setAlbumFavorite', { id: 1, favorite: true })
    ).resolves.toMatchObject({
      outcome: { status: outcome },
      synchronization: 'not-required',
    });
  }
);

test('confirmed remote write remains successful when real HTTP synchronization fails', async () => {
  respond = (req, res) =>
    req.url.startsWith('/album/sub?')
      ? reply(res, { code: 200 })
      : reply(res, { message: 'offline' }, 503);
  await expect(
    store.dispatch('library/setAlbumFavorite', { id: 1, favorite: true })
  ).resolves.toMatchObject({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
});

test('full library write propagates original preparation error instead of claiming network uncertainty', async () => {
  const original = new TypeError('invalid settings');
  configureRequest({
    getSettings: () => {
      throw original;
    },
    getCookie: () => '',
    onSessionInvalid() {},
  });
  await expect(
    store.dispatch('library/setAlbumFavorite', { id: 1, favorite: true })
  ).rejects.toBe(original);
});

test('invalidation finishing after a new identity handoff leaves its navigation and notices alone', async () => {
  router.currentRoute = { name: 'library', meta: { requireLogin: true } };
  const invalidation = store.dispatch('session/invalidate', {
    ownership: store.getters['session/ownership'],
  });
  respond = (req, res) => reply(res, { playlist: [] });
  const handoff = store.dispatch('session/selectPublicIdentity', { userId: 2 });
  await Promise.all([invalidation, handoff]);
  expect(notices).toEqual([]);
  expect(router.push).not.toHaveBeenCalled();
});
