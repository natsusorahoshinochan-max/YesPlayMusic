/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import { mount } from '@vue/test-utils';
import TrackList from '@/components/TrackList.vue';
import { createStore } from '@/store';
import { ipcRenderer } from '@/electron/ipcRenderer';
import { initializeLocale } from '@/locale';
Vue.use(Vuex);
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
  await Vue.nextTick();
};
function setup(mode = 'account') {
  initializeLocale('zh-CN');
  localStorage.clear();
  localStorage.setItem(
    'data',
    JSON.stringify({
      loginMode: mode,
      user: { userId: 3 },
      likedSongPlaylistID: 99,
    })
  );
  const api = {
    likeATrack: jest.fn().mockResolvedValue({ body: { code: 200 } }),
    getPlaylistDetail: jest.fn().mockResolvedValue({
      playlist: {
        id: 99,
        trackIds: [{ id: 20 }],
        tracks: [{ id: 20 }],
        trackCount: 1,
      },
    }),
    getTrackDetail: jest.fn().mockResolvedValue({ songs: [{ id: 20 }] }),
  };
  const messages = [];
  const store = createStore({
    credentials: { get: () => (mode === 'account' ? 'token' : null) },
    library: { api },
    actions: { showToast: (_, message) => messages.push(message) },
  });
  store.state.player = { currentTrack: { id: 20 } };
  return { store, api, messages };
}
test.each([null, 'username', 'account'])(
  'Electron favorite uses real operation permission for %p identity',
  async mode => {
    const { store, api, messages } = setup(mode);
    const listeners = {};
    const original = window.require;
    window.require = name =>
      name === 'os'
        ? { platform: () => 'darwin' }
        : {
            ipcRenderer: {
              on: (event, fn) => {
                listeners[event] = fn;
              },
            },
          };
    try {
      ipcRenderer({});
      await listeners.like();
      if (mode === 'account') {
        expect(api.likeATrack).toHaveBeenCalledWith({ id: 20, like: true });
        expect(store.getters['library/collections'].songs).toEqual([20]);
        expect(store.getters['library/collections'].songsWithDetails).toEqual([
          { id: 20 },
        ]);
        expect(messages).toEqual([]);
      } else {
        expect(api.likeATrack).not.toHaveBeenCalled();
        expect(messages).toEqual(['此操作需要登录网易云帐号']);
      }
    } finally {
      window.require = original;
    }
  }
);
test('Electron feedback distinguishes unconfirmed transport from confirmed write with failed preview', async () => {
  const { api, messages } = setup();
  const listeners = {};
  const original = window.require;
  window.require = name =>
    name === 'os'
      ? { platform: () => 'darwin' }
      : {
          ipcRenderer: {
            on: (event, fn) => {
              listeners[event] = fn;
            },
          },
        };
  try {
    ipcRenderer({});
    api.likeATrack.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { isAxiosError: true })
    );
    await listeners.like();
    expect(messages).toEqual(['offline']);
    api.getPlaylistDetail.mockRejectedValue(new Error('read failed'));
    await listeners.like();
    expect(messages[1]).toContain('操作已完成');
  } finally {
    window.require = original;
  }
});
test.each([null, 'account'])(
  'track item favorite works without parent favorite method for %p identity',
  async mode => {
    const { store, api, messages } = setup(mode);
    const wrapper = mount(TrackList, {
      store,
      i18n: initializeLocale('zh-CN'),
      propsData: {
        type: 'playlist',
        tracks: [
          {
            id: 20,
            name: 'Song',
            al: { id: 5, picUrl: '', name: 'Album' },
            ar: [{ name: 'Artist' }],
            alia: [],
            privilege: { pl: 320000 },
          },
        ],
      },
      stubs: {
        ContextMenu: { template: '<div><slot /></div>' },
        ArtistsInLine: true,
        ExplicitSymbol: true,
        'svg-icon': true,
        'router-link': true,
      },
      filters: { formatTime: () => '', resizeImage: value => value },
    });
    expect(wrapper.vm.toggleTrackFavorite).toBeUndefined();
    await wrapper.find('.actions button').trigger('click');
    await flush();
    if (mode === 'account') {
      expect(api.likeATrack).toHaveBeenCalledWith({ id: 20, like: true });
      expect(store.getters['library/collections'].songs).toEqual([20]);
    } else {
      expect(api.likeATrack).not.toHaveBeenCalled();
      expect(messages).toEqual(['此操作需要登录网易云帐号']);
    }
    wrapper.destroy();
  }
);
