/** @jest-environment jsdom */
import http from 'http';
import { createStore } from '@/store';
import * as auth from '@/api/auth';
import { libraryApi } from '@/application/library';
import { configureRequest } from '@/utils/request';
import { createRequestEnvironment } from '@/application/requestEnvironment';
jest.mock('vscode-codicons/dist/codicon.css', () => ({}));
jest.mock('@/utils/nativeAlert', () => jest.fn());
import LoginAccount from '@/views/loginAccount.vue';
import Navbar from '@/components/Navbar.vue';
import Lyrics from '@/views/lyrics.vue';
import { createSessionEffects } from '@/application/sessionEffects';
import LoginUsername from '@/views/loginUsername.vue';
import Library from '@/views/library.vue';
import NProgress from 'nprogress';
import ModalNewPlaylist from '@/components/ModalNewPlaylist.vue';

let server;
let baseURL;
let requests;
let responses;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    requests.push(path);
    const response = responses[path];
    res.writeHead(response ? 200 : 503, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'http://localhost',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end(JSON.stringify(response || { message: 'controlled outage' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  requests = [];
  responses = {};
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => '',
    onSessionInvalid: () => {},
    environment: createRequestEnvironment({ webBaseURL: baseURL }),
  });
});
function setup(account = false, overrides = {}) {
  const navigate = jest.fn();
  const notify = jest.fn();
  const alert = jest.fn();
  const credentials = {
    get: () => (account ? 'credential' : ''),
    set: jest.fn(),
    remove: jest.fn(),
  };
  const store = createStore({
    storage: {
      getItem: key =>
        key === 'data'
          ? JSON.stringify({
              loginMode: account ? 'account' : null,
              user: { userId: 42 },
            })
          : null,
      setItem: () => {},
    },
    language: 'en',
    credentials,
    session: { auth, navigate, notify, alert, ...overrides },
    library: { api: libraryApi },
  });
  return { store, navigate, notify, alert };
}

test('public identity confirmation ends with feedback and no navigation when HTTP playlist read fails', async () => {
  const { store, navigate, notify } = setup();
  await expect(
    LoginUsername.methods.confirm.call({
      $store: store,
      activeUser: { userId: 42 },
    })
  ).resolves.toBe(false);
  expect(requests).toContain('/user/playlist');
  expect(navigate).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalled();
});

test('ordinary password HTTP failure reports failure and clears processing without success navigation', async () => {
  const { store, alert, navigate } = setup();
  await LoginAccount.methods.login.call({
    $store: store,
    mode: 'email',
    email: 'a@b.c',
    password: 'secret',
    validateEmail: () => true,
  });
  expect(requests).toContain('/login');
  expect(alert).toHaveBeenCalled();
  expect(store.getters['session/processing']).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});

test('QR HTTP check failure ends polling with retry feedback', async () => {
  responses['/login/qr/key'] = { code: 200, data: { unikey: 'key' } };
  const callbacks = [];
  const { store } = setup(false, {
    time: { schedule: callback => callbacks.push(callback), cancel: () => {} },
  });
  await store.dispatch('session/startQrLogin');
  await callbacks.shift()();
  expect(requests).toContain('/login/qr/check');
  expect(callbacks).toHaveLength(0);
  expect(store.getters['session/qr'].information).toContain('失败');
});

test('failed refresh leaves refresh date unset and reports background failure', async () => {
  const { store, notify } = setup(true);
  await expect(store.dispatch('session/refreshDaily')).resolves.toBe(false);
  expect(requests).toContain('/login/refresh');
  expect(store.state.session.lastRefreshCookieDate).not.toBe(
    new Date().getDate()
  );
  expect(notify).toHaveBeenCalled();
});

test('create modal retains input and does not send addition after unconfirmed HTTP create', async () => {
  const { store } = setup(true);
  const close = jest.fn();
  const showToast = jest.fn();
  await ModalNewPlaylist.methods.createPlaylist.call({
    $store: store,
    title: 'draft',
    privatePlaylist: false,
    modals: { newPlaylistModal: { afterCreateAddTrackID: 10 } },
    close,
    showToast,
  });
  expect(requests).toEqual(['/playlist/create']);
  expect(close).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('未能确认'));
});

test('upload file preparation failure ends at the actual upload caller with feedback', async () => {
  const { store } = setup(true);
  // Browser FormData is a platform I/O boundary; appending a file can reject.
  const previous = global.FormData;
  global.FormData = class {
    append() {
      throw new Error('file unavailable');
    }
  };
  try {
    await expect(
      Library.methods.uploadSongToCloudDisk.call(
        {
          $store: store,
          showToast: message => store.dispatch('showToast', message),
        },
        { target: { files: [{}] } }
      )
    ).resolves.toBeUndefined();
    expect(store.state.toast.text).toBe('file unavailable');
    clearTimeout(store.state.toast.timer);
  } finally {
    global.FormData = previous;
  }
});

test('library page HTTP failure releases display wait and delayed progress without success followup', async () => {
  const { store } = setup(true);
  const page = {
    $store: store,
    previewReady: false,
    show: false,
    showToast: jest.fn(),
    getRandomLyric: jest.fn(),
  };
  const done = jest.spyOn(NProgress, 'done').mockImplementation(() => {});
  await Library.methods.loadData.call(page);
  expect(page.show).toBe(true);
  expect(page.showToast).toHaveBeenCalledWith('音乐库加载失败');
  expect(page.getRandomLyric).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalled();
  expect(requests).toEqual(['/user/account']);
});

test('QR initial HTTP failure returns feedback without scheduling work', async () => {
  const schedule = jest.fn();
  const { store } = setup(false, { time: { schedule, cancel: () => {} } });
  await expect(store.dispatch('session/startQrLogin')).resolves.toBe(false);
  expect(store.getters['session/qr'].information).toContain('失败');
  expect(schedule).not.toHaveBeenCalled();
});

test('confirmed creation survives failed HTTP addition and failed synchronization in the actual modal', async () => {
  responses['/playlist/create'] = { code: 200, id: 77 };
  const { store } = setup(true);
  const close = jest.fn();
  const showToast = jest.fn();
  await ModalNewPlaylist.methods.createPlaylist.call({
    $store: store,
    title: 'draft',
    privatePlaylist: false,
    modals: { newPlaylistModal: { afterCreateAddTrackID: 10 } },
    close,
    showToast,
  });
  expect(requests).toContain('/playlist/tracks');
  expect(requests).toContain('/user/playlist');
  expect(close).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith(
    expect.stringMatching(/成功创建歌单.*未能确认.*部分内容更新失败/)
  );
});

test('public confirmation consumes the actual endpoint parsing rejection after HTTP preview failure', async () => {
  responses['/user/playlist'] = { playlist: [{ id: 99 }] };
  const { store, navigate } = setup();
  await expect(
    LoginUsername.methods.confirm.call({
      $store: store,
      activeUser: { userId: 42 },
    })
  ).resolves.toBe(false);
  expect(requests).toEqual(['/user/playlist', '/playlist/detail']);
  expect(navigate).not.toHaveBeenCalled();
  expect(store.getters['session/processing']).toBe(false);
});

test('lyrics playlist menu waits for HTTP refresh and does not open a modal after failure', async () => {
  const { store } = setup(true);
  const updateModal = jest.fn();
  const showToast = jest.fn();
  await Lyrics.methods.addToPlaylist.call({
    $store: store,
    updateModal,
    showToast,
  });
  expect(requests).toEqual(['/user/playlist']);
  expect(updateModal).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('歌单加载失败，请重试');
});

test('navbar local logout completes even when navigation I/O rejects', async () => {
  const notify = jest.fn();
  const router = {
    currentRoute: { name: 'library' },
    push: () => Promise.reject(new Error('navigation unavailable')),
  };
  const effects = createSessionEffects({ router, notify, alert: () => {} });
  const { store } = setup(true, effects);
  global.confirm = () => true;
  try {
    await expect(Navbar.methods.logout.call({ $store: store })).resolves.toBe(
      false
    );
    expect(store.getters['session/hasAccount']).toBe(false);
    expect(notify).toHaveBeenCalledWith('已退出登录，页面跳转失败');
    if (!requests.includes('/logout'))
      await new Promise(resolve => server.once('request', resolve));
  } finally {
    delete global.confirm;
  }
});
