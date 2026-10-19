/* eslint-env jest */
import { createStore } from '@/store';
import { createCredentials } from '@/application/credentials';
global.TextEncoder = require('util').TextEncoder;

function setup({ auth = {}, session = {} } = {}) {
  const api = {
    userAccount: jest
      .fn()
      .mockResolvedValue({ code: 200, profile: { userId: 7 } }),
    userPlaylist: jest.fn().mockResolvedValue({ playlist: [{ id: 20 }] }),
    getPlaylistDetail: jest
      .fn()
      .mockResolvedValue({ playlist: { trackIds: [{ id: 50 }] } }),
    getTrackDetail: jest
      .fn()
      .mockResolvedValue({ songs: [{ id: 50, name: 'preview' }] }),
    userLikedSongsIDs: jest.fn().mockResolvedValue({ ids: [50] }),
    likedAlbums: jest.fn().mockResolvedValue({ data: [] }),
    likedArtists: jest.fn().mockResolvedValue({ data: [] }),
    likedMVs: jest.fn().mockResolvedValue({ data: [] }),
    cloudDisk: jest.fn().mockResolvedValue({ data: [] }),
  };
  const navigate = jest.fn();
  const alert = jest.fn();
  const credentials = createCredentials({
    cookies: { get: () => undefined, remove() {} },
  });
  const store = createStore({
    credentials,
    session: { auth, navigate, alert, ...session },
    library: { api },
  });
  return { store, api, credentials, navigate, alert };
}

beforeEach(() => localStorage.clear());

test('phone entry establishes an account with a displayable library before navigation and never persists a password', async () => {
  let respond;
  const auth = {
    loginWithPhone: jest.fn(
      () =>
        new Promise(resolve => {
          respond = resolve;
        })
    ),
  };
  const { store, api, credentials, navigate } = setup({ auth });
  const entry = store.dispatch('session/loginWithPassword', {
    mode: 'phone',
    countryCode: '+86',
    phone: '123 456',
    password: 'password',
  });
  expect(store.getters['session/processing']).toBe(true);
  expect(auth.loginWithPhone).toHaveBeenCalledWith({
    countrycode: '86',
    phone: '123456',
    password: 'fakePassword',
    md5_password: '5f4dcc3b5aa765d61d8327deb882cf99',
  });
  expect(navigate).not.toHaveBeenCalled();
  respond({
    code: 200,
    cookie: 'MUSIC_U=account-token; path=/;;__csrf=csrf-token; path=/',
  });
  await entry;
  expect(credentials.get('MUSIC_U')).toBe('account-token');
  expect(store.getters['session/hasAccount']).toBe(true);
  expect(api.userPlaylist).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 7 })
  );
  expect(store.getters['library/collections'].songsWithDetails).toEqual([
    { id: 50, name: 'preview' },
  ]);
  expect(store.getters['library/previewReady']).toBe(true);
  expect(navigate).toHaveBeenCalledWith('account');
  expect(store.getters['session/processing']).toBe(false);
  expect(localStorage.getItem('data')).not.toContain('password');
  expect(JSON.stringify(store.state.session)).not.toContain('password');
});

test('email entry chooses email authentication and interprets rejection without credentials or navigation', async () => {
  const auth = {
    loginWithEmail: jest
      .fn()
      .mockResolvedValue({ code: 502, message: 'wrong password' }),
  };
  const { store, credentials, navigate, alert } = setup({ auth });
  await store.dispatch('session/loginWithPassword', {
    mode: 'email',
    email: 'name @163.com',
    password: 'password',
  });
  expect(auth.loginWithEmail).toHaveBeenCalledWith({
    email: 'name@163.com',
    password: 'fakePassword',
    md5_password: '5f4dcc3b5aa765d61d8327deb882cf99',
  });
  expect(alert).toHaveBeenCalledWith('wrong password');
  expect(credentials.get('MUSIC_U')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  expect(store.getters['session/processing']).toBe(false);
  auth.loginWithEmail.mockResolvedValue({
    code: 200,
    cookie: 'MUSIC_U=email-token; path=/',
  });
  await store.dispatch('session/loginWithPassword', {
    mode: 'email',
    email: 'name@163.com',
    password: 'password',
  });
  expect(store.getters['library/previewReady']).toBe(true);
  expect(navigate).toHaveBeenCalledWith('account');
});

test('public library identity selection loads public preview before navigation without account endpoints', async () => {
  const { store, api, navigate, credentials } = setup();
  await store.dispatch('session/selectPublicIdentity', {
    userId: 99,
    nickname: 'public',
  });
  expect(store.getters['session/hasAccount']).toBe(false);
  expect(store.getters['session/hasLibraryIdentity']).toBe(true);
  expect(api.userPlaylist).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 99 })
  );
  expect(store.getters['library/collections'].songsWithDetails).toEqual([
    { id: 50, name: 'preview' },
  ]);
  expect(navigate).toHaveBeenCalledWith('publicIdentity');
  expect(credentials.get('MUSIC_U')).toBeNull();
  for (const endpoint of [
    'userAccount',
    'userLikedSongsIDs',
    'likedAlbums',
    'likedArtists',
    'likedMVs',
    'cloudDisk',
  ])
    expect(api[endpoint]).not.toHaveBeenCalled();
});

function controlledTime() {
  const pending = new Map();
  let id = 0;
  return {
    schedule(callback, delay) {
      pending.set(++id, { callback, delay });
      return id;
    },
    cancel(handle) {
      pending.delete(handle);
    },
    count: () => pending.size,
    async tick() {
      const [handle, task] = pending.entries().next().value;
      pending.delete(handle);
      expect(task.delay).toBe(1000);
      await task.callback();
    },
  };
}

test('QR entry interprets waiting, confirmation, expiry and approval and loads the account preview', async () => {
  const time = controlledTime();
  const auth = {
    loginQrCodeKey: jest
      .fn()
      .mockResolvedValueOnce({ code: 200, data: { unikey: 'first' } })
      .mockResolvedValue({ code: 200, data: { unikey: 'renewed' } }),
    loginQrCodeCheck: jest
      .fn()
      .mockResolvedValueOnce({ code: 801 })
      .mockResolvedValueOnce({ code: 802 })
      .mockResolvedValueOnce({ code: 800 })
      .mockResolvedValueOnce({
        code: 803,
        cookie: 'MUSIC_U=qr-token; HTTPOnly; path=/',
      }),
  };
  const { store, credentials, navigate } = setup({ auth, session: { time } });
  await store.dispatch('session/startQrLogin');
  expect(store.getters['session/qr'].url).toBe(
    'https://music.163.com/login?codekey=first'
  );
  await time.tick();
  expect(store.getters['session/qr'].information).toBe(
    '打开网易云音乐APP扫码登录'
  );
  await time.tick();
  expect(store.getters['session/qr'].information).toBe(
    '扫描成功，请在手机上确认登录'
  );
  await time.tick();
  expect(store.getters['session/qr'].url).toBe(
    'https://music.163.com/login?codekey=renewed'
  );
  expect(store.getters['session/qr'].information).toBe(
    '二维码已失效，请重新扫码'
  );
  await time.tick();
  expect(auth.loginQrCodeCheck).toHaveBeenLastCalledWith('renewed');
  expect(store.getters['session/qr'].information).toBe('登录成功，请稍等...');
  expect(store.getters['session/hasAccount']).toBe(true);
  expect(store.getters['library/previewReady']).toBe(true);
  expect(credentials.get('MUSIC_U')).toBe('qr-token');
  expect(navigate).toHaveBeenCalledWith('account');
  expect(time.count()).toBe(0);
});

test('account page starts QR only in QR mode and releases pending polling on mode switch and destroy', async () => {
  const { shallowMount } = require('@vue/test-utils');
  const LoginAccount = require('@/views/loginAccount.vue').default;
  const time = controlledTime();
  let respond;
  const auth = {
    loginQrCodeKey: jest
      .fn()
      .mockResolvedValue({ code: 200, data: { unikey: 'key' } }),
    loginQrCodeCheck: jest.fn(
      () =>
        new Promise(resolve => {
          respond = resolve;
        })
    ),
  };
  const { store, navigate } = setup({ auth, session: { time } });
  const page = shallowMount(LoginAccount, {
    store,
    mocks: { $route: { query: { mode: 'phone' } }, $t: key => key },
    stubs: ['svg-icon'],
  });
  expect(auth.loginQrCodeKey).not.toHaveBeenCalled();
  await page.vm.changeMode('qrCode');
  expect(time.count()).toBe(1);
  const poll = time.tick();
  await page.vm.changeMode('email');
  respond({ code: 801 });
  await poll;
  expect(time.count()).toBe(0);
  expect(navigate).not.toHaveBeenCalled();
  await page.vm.changeMode('qrCode');
  expect(time.count()).toBe(1);
  page.destroy();
  expect(time.count()).toBe(0);
});

test.each([false, true])(
  'application entry effects navigate to the library after preview (Electron: %s)',
  async isElectron => {
    const { createSessionEffects } = require('@/application/sessionEffects');
    const pages = [];
    const effects = createSessionEffects({
      isElectron,
      router: {
        currentRoute: { name: 'loginAccount' },
        push: page => pages.push(page),
      },
    });
    const auth = {
      loginWithEmail: jest.fn().mockResolvedValue({
        code: 200,
        cookie: 'MUSIC_U=account-token; path=/',
      }),
    };
    const { store } = setup({ auth, session: effects });
    await store.dispatch('session/loginWithPassword', {
      mode: 'email',
      email: 'name@163.com',
      password: 'password',
    });
    expect(store.getters['library/previewReady']).toBe(true);
    await store.dispatch('session/selectPublicIdentity', { userId: 99 });
    expect(pages).toEqual([{ name: 'library' }, { name: 'library' }]);
  }
);

test('stopping while a QR key is pending prevents rescheduling, including after a fresh start', async () => {
  const time = controlledTime();
  let resolveOld;
  const auth = {
    loginQrCodeKey: jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValue({ code: 200, data: { unikey: 'fresh' } }),
  };
  const { store } = setup({ auth, session: { time } });
  const oldStart = store.dispatch('session/startQrLogin');
  await store.dispatch('session/stopQrLogin');
  await store.dispatch('session/startQrLogin');
  resolveOld({ code: 200, data: { unikey: 'old' } });
  await oldStart;
  expect(store.getters['session/qr'].url).toBe(
    'https://music.163.com/login?codekey=fresh'
  );
  expect(time.count()).toBe(1);
  await store.dispatch('session/stopQrLogin');
  expect(time.count()).toBe(0);
});

test('QR expiry retains polling when key renewal temporarily has no response', async () => {
  const time = controlledTime();
  const auth = {
    loginQrCodeKey: jest
      .fn()
      .mockResolvedValueOnce({ code: 200, data: { unikey: 'expired' } })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ code: 200, data: { unikey: 'renewed' } }),
    loginQrCodeCheck: jest.fn().mockResolvedValue({ code: 800 }),
  };
  const { store } = setup({ auth, session: { time } });
  await store.dispatch('session/startQrLogin');
  await time.tick();
  expect(time.count()).toBe(1);
  await time.tick();
  expect(store.getters['session/qr'].url).toBe(
    'https://music.163.com/login?codekey=renewed'
  );
  expect(time.count()).toBe(1);
  await store.dispatch('session/stopQrLogin');
  expect(time.count()).toBe(0);
});
