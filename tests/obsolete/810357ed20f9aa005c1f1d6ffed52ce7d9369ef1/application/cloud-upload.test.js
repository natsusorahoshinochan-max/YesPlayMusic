/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import * as userApi from '@/api/user';
import request, { configureRequest } from '@/utils/request';
import createLibrary from '@/store/modules/library';
import createSession from '@/store/modules/session';

Vue.use(Vuex);

function setup(adapter, remove = () => {}) {
  const store = new Vuex.Store({
    modules: {
      session: createSession(
        { loginMode: 'account' },
        { credentials: { get: () => 'credential', remove } }
      ),
      library: createLibrary({ user: { userId: 3 } }, { api: userApi }),
    },
  });
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => 'credential',
    onSessionInvalid: () => store.dispatch('session/invalidate'),
  });
  request.defaults.adapter = adapter;
  return store;
}

const originalAdapter = request.defaults.adapter;
afterEach(() => {
  request.defaults.adapter = originalAdapter;
});

test('production cloud upload propagates a programming error during session invalidation without alerts', async () => {
  const failure = new TypeError('credential storage unavailable');
  const store = setup(
    config =>
      Promise.reject({
        isAxiosError: true,
        config,
        response: { data: { code: 301, msg: '需要登录' } },
      }),
    () => {
      throw failure;
    }
  );
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  await expect(
    store.dispatch('library/uploadCloudTrack', new File(['song'], 'song.mp3'))
  ).rejects.toBe(failure);
  expect(alert).not.toHaveBeenCalled();
});

test('production cloud upload reports transport failure as unconfirmed without alerts', async () => {
  const store = setup(() =>
    Promise.reject(Object.assign(new Error('offline'), { isAxiosError: true }))
  );
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  await expect(
    store.dispatch('library/uploadCloudTrack', new File(['song'], 'song.mp3'))
  ).resolves.toEqual({
    outcome: { status: 'unconfirmed' },
    synchronization: 'not-required',
  });
  expect(alert).not.toHaveBeenCalled();
});
