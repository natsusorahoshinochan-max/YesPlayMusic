/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import { mount } from '@vue/test-utils';
import Playlist from '@/views/playlist.vue';
import createLibrary from '@/store/modules/library';
import createPlaylistDetail from '@/store/modules/playlistDetail';
import createSession from '@/store/modules/session';
import { initializeLocale } from '@/locale';
Vue.use(Vuex);
Vue.filter('resizeImage', value => value);
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await Vue.nextTick();
};
const track = id => ({
  id,
  name: `Song ${id}`,
  al: { name: 'Album', picUrl: '' },
  ar: [{ name: 'Artist' }],
});
function setup(loginMode = 'account', credential = 'credential') {
  const api = {
    getPlaylistDetail: jest.fn(id =>
      Promise.resolve({
        playlist: {
          id: Number(id),
          name: 'My Playlist',
          coverImgUrl: '',
          creator: { userId: 3 },
          trackCount: 105,
          trackIds: Array.from({ length: 105 }, (_, i) => ({ id: i + 1 })),
          tracks: [track(1)],
        },
      })
    ),
    getTrackDetail: jest.fn(ids =>
      Promise.resolve({
        songs: ids
          .split(',')
          .filter(Boolean)
          .map(id => track(Number(id))),
      })
    ),
    addOrRemoveTrackFromPlaylist: jest
      .fn()
      .mockResolvedValue({ body: { code: 200 } }),
    subscribePlaylist: jest.fn().mockResolvedValue({ body: { code: 200 } }),
    deletePlaylist: jest.fn().mockResolvedValue({ code: 200 }),
    userPlaylist: jest.fn().mockResolvedValue({ playlist: [{ id: 20 }] }),
  };
  const store = new Vuex.Store({
    state: { player: {} },
    actions: {
      showToast({ commit }, message) {
        commit('toast', message);
      },
    },
    mutations: {
      toast(state, message) {
        Vue.set(state, 'message', message);
      },
    },
    modules: {
      session: createSession(
        { loginMode },
        { credentials: { get: () => credential } }
      ),
      library: createLibrary(
        { user: { userId: 3 }, likedSongPlaylistID: 99 },
        { api }
      ),
      playlistDetail: createPlaylistDetail({ api }),
    },
  });
  const route = Vue.observable({ name: 'playlist', params: { id: 20 } });
  const router = { go: jest.fn() };
  const wrapper = mount(Playlist, {
    store,
    i18n: initializeLocale('zh-CN'),
    mocks: { $route: route, $router: router },
    filters: { resizeImage: value => value, formatDate: value => value },
    stubs: {
      Cover: true,
      ButtonTwoTone: {
        template: '<button @click="$emit(\'click\')"><slot /></button>',
      },
      Modal: true,
      ContextMenu: {
        template: '<div><slot /></div>',
        methods: { openMenu() {} },
      },
      TrackListItem: {
        props: ['trackProp'],
        template: '<div class="song">{{trackProp.name}}</div>',
      },
      'svg-icon': true,
    },
  });
  return { wrapper, store, api, route, router };
}
test('playlist opens store detail, confirms removal, shows feedback and continues browsing', async () => {
  const { wrapper, store, api } = setup();
  await flush();
  expect(store.getters['playlistDetail/current']?.playlist.id).toBe(20);
  expect(wrapper.findAll('.song')).toHaveLength(101);
  await wrapper.find('.song').trigger('contextmenu');
  const remove = wrapper
    .findAll('.item')
    .wrappers.find(item => item.text() === '从歌单中删除');
  jest
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValue(true);
  await remove.trigger('click');
  expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
  await remove.trigger('click');
  await flush();
  expect(store.state.message).toBe('已从歌单中删除');
  expect(wrapper.findAll('.song')).toHaveLength(100);
  const more = wrapper
    .findAll('button')
    .wrappers.find(button => button.text() === '加载更多');
  await more.trigger('click');
  await flush();
  expect(wrapper.findAll('.song')).toHaveLength(104);
  wrapper.destroy();
  expect(store.getters['playlistDetail/current']).toBeNull();
});

test.each([
  ['guest', null, null],
  ['public library identity', 'username', 'credential'],
  ['account snapshot without credentials', 'account', null],
])(
  'playlist lets library deny %s while browsing target changes',
  async (_, loginMode, credential) => {
    const { wrapper, store, api, route } = setup(loginMode, credential);
    await flush();
    route.params.id = 30;
    await flush();
    expect(store.getters['playlistDetail/current'].playlist.id).toBe(30);
    await wrapper.find('.song').trigger('contextmenu');
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const remove = wrapper
      .findAll('.item')
      .wrappers.find(item => item.text() === '从歌单中删除');
    await remove.trigger('click');
    await flush();
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
    expect(store.state.message).toBe('此操作需要登录网易云帐号');
    expect(wrapper.findAll('.song')).toHaveLength(101);
    wrapper.destroy();
  }
);

test('playlist favorite applies confirmed state and feedback even when synchronization fails', async () => {
  const { wrapper, store, api } = setup();
  await flush();
  api.userPlaylist.mockRejectedValue(new Error('offline'));
  api.getPlaylistDetail.mockRejectedValue(new Error('offline'));
  const favorite = wrapper
    .findAll('.item')
    .wrappers.find(item => item.text() === '保存到音乐库');
  await favorite.trigger('click');
  await flush();
  expect(store.getters['playlistDetail/current'].playlist.subscribed).toBe(
    true
  );
  expect(store.state.message).toContain('更新失败');
  wrapper.destroy();
});
test('deleting playlist confirms in UI and navigates after confirmed write despite refresh failure', async () => {
  const { wrapper, store, api, router } = setup();
  await flush();
  jest
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  const remove = wrapper
    .findAll('.item')
    .wrappers.find(item => item.text() === '删除歌单');
  await remove.trigger('click');
  expect(api.deletePlaylist).not.toHaveBeenCalled();
  api.userPlaylist.mockRejectedValue(new Error('offline'));
  await remove.trigger('click');
  await flush();
  expect(store.getters['playlistDetail/current']).toBeNull();
  expect(router.go).toHaveBeenCalledWith(-1);
  wrapper.destroy();
});
