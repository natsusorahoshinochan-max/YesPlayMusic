/* eslint-env jest */
import Vue from 'vue';
import Vuex from 'vuex';
import { mount } from '@vue/test-utils';
import Playlist from '@/views/playlist.vue';
import createLibrary from '@/store/modules/library';
import createPlaylistDetail from '@/store/modules/playlistDetail';
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
function setup(account = true) {
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
    userPlaylist: jest.fn().mockResolvedValue({ playlist: [{ id: 20 }] }),
  };
  const store = new Vuex.Store({
    state: { player: {} },
    getters: { 'session/hasAccount': () => account },
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
      library: createLibrary(
        { user: { userId: 3 }, likedSongPlaylistID: 99 },
        { api }
      ),
      playlistDetail: createPlaylistDetail({ api }),
    },
  });
  const route = Vue.observable({ name: 'playlist', params: { id: 20 } });
  const wrapper = mount(Playlist, {
    store,
    i18n: initializeLocale('zh-CN'),
    mocks: { $route: route },
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
  return { wrapper, store, api, route };
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

test('playlist reacts to target changes and lets library return account-required feedback', async () => {
  const { wrapper, store, api, route } = setup(false);
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
});
