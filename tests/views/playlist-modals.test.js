/* eslint-env jest */
import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { createStore } from '@/store';
import rootActions from '@/store/actions';
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
import { initializeLocale } from '@/locale';
import NewPlaylist from '@/components/ModalNewPlaylist.vue';
import AddTracks from '@/components/ModalAddTrackToPlaylist.vue';
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await Vue.nextTick();
};
function setup(
  component = NewPlaylist,
  {
    creation = { code: 200, id: 20 },
    addition = { body: { code: 200 } },
    failRefresh = false,
    mode = 'account',
  } = {}
) {
  initializeLocale('zh-CN');
  const values = {
    data: JSON.stringify({
      loginMode: mode,
      user: { userId: 3 },
      likedSongPlaylistID: 99,
      libraryPlaylistFilter: 'all',
    }),
  };
  const messages = [];
  const storage = {
    getItem: key => values[key] || null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const api = {
    getPlaylistDetail: jest.fn(id =>
      Promise.resolve({
        playlist: { id, trackIds: [], tracks: [], trackCount: 0 },
      })
    ),
    createPlaylist: jest.fn().mockResolvedValue(creation),
    addOrRemoveTrackFromPlaylist: jest.fn().mockResolvedValue(addition),
    userPlaylist: jest.fn(() =>
      failRefresh
        ? Promise.reject(new Error('read failed'))
        : Promise.resolve({
            playlist: [
              { id: 99, creator: { userId: 3 } },
              { id: 20, creator: { userId: 3 }, name: 'Target' },
            ],
          })
    ),
  };
  const store = createStore({
    storage,
    credentials: { get: () => 'credential' },
    library: { api },
    actions: {
      showToast: (context, message) => {
        messages.push(message);
        return rootActions.showToast(context, message);
      },
    },
  });
  store.commit('updateModal', {
    modalName: 'newPlaylistModal',
    key: 'show',
    value: true,
  });
  store.commit('updateModal', {
    modalName: 'newPlaylistModal',
    key: 'afterCreateAddTrackID',
    value: 7,
  });
  store.commit('updateModal', {
    modalName: 'addTrackToPlaylistModal',
    key: 'show',
    value: true,
  });
  store.commit('updateModal', {
    modalName: 'addTrackToPlaylistModal',
    key: 'selectedTrackID',
    value: 7,
  });
  const wrapper = mount(component, {
    store,
    stubs: {
      Modal: { template: '<div><slot /><slot name="footer" /></div>' },
      'svg-icon': true,
    },
    filters: { resizeImage: value => value },
  });
  return { wrapper, store, api, messages, storage };
}

test('creation remains successful when optional addition fails and persists the mine filter', async () => {
  const { wrapper, store, api, messages, storage } = setup(NewPlaylist, {
    addition: { body: { code: 502, message: '无法添加歌曲' } },
  });
  await store.dispatch('preferences/applyRestored');
  storage.setItem.mockClear();
  await wrapper.find('input[type="text"]').setValue('New List');
  await wrapper.find('input[type="checkbox"]').setChecked(true);
  await wrapper.find('button').trigger('click');
  await flush();
  expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual(['data']);
  expect(api.createPlaylist).toHaveBeenCalledWith({
    name: 'New List',
    privacy: 10,
  });
  expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
    op: 'add',
    pid: 20,
    tracks: '7',
  });
  expect(store.state.modals.newPlaylistModal.show).toBe(false);
  expect(messages).toEqual(['成功创建歌单；无法添加歌曲']);
  expect(store.getters['preferences/libraryPlaylistFilter']).toBe('mine');
  expect(JSON.parse(storage.getItem('data')).libraryPlaylistFilter).toBe(
    'mine'
  );
  wrapper.destroy();
});

test('global addition updates matching detail without a playlist page and closes with independent sync feedback', async () => {
  const { wrapper, store, api, messages } = setup(AddTracks);
  await store.dispatch('library/refreshPlaylists');
  await store.dispatch('playlistDetail/open', 20);
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      id: 20,
      trackIds: [{ id: 7 }],
      tracks: [{ id: 7 }],
      trackCount: 1,
    },
  });
  api.userPlaylist.mockRejectedValue(new Error('read failed'));
  await Vue.nextTick();
  await wrapper.find('.playlist').trigger('click');
  await flush();
  expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
    op: 'add',
    pid: 20,
    tracks: '7',
  });
  expect(store.getters['playlistDetail/current'].tracks.map(t => t.id)).toEqual(
    [7]
  );
  expect(store.state.modals.addTrackToPlaylistModal.show).toBe(false);
  expect(messages).toEqual(['已添加到歌单；部分内容更新失败，请稍后刷新']);
  wrapper.destroy();
});

test.each([
  [{ code: 502, message: '无法创建' }, '无法创建'],
  [null, '未能确认操作结果，请稍后刷新查看'],
])(
  'creation %p keeps the modal and current filter for correction',
  async (creation, message) => {
    const { wrapper, store, api, messages } = setup(NewPlaylist, { creation });
    await wrapper.find('button').trigger('click');
    await flush();
    expect(store.state.modals.newPlaylistModal.show).toBe(true);
    expect(store.getters['preferences/libraryPlaylistFilter']).toBe('all');
    expect(messages).toEqual([message]);
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
    wrapper.destroy();
  }
);

test('creating without optional songs closes and reports successful creation despite a refresh failure', async () => {
  const { wrapper, store, api, messages } = setup(NewPlaylist, {
    failRefresh: true,
  });
  store.commit('updateModal', {
    modalName: 'newPlaylistModal',
    key: 'afterCreateAddTrackID',
    value: 0,
  });
  await wrapper.find('button').trigger('click');
  await flush();
  expect(store.state.modals.newPlaylistModal.show).toBe(false);
  expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
  expect(messages).toEqual(['成功创建歌单；部分内容更新失败，请稍后刷新']);
  expect(store.getters['preferences/libraryPlaylistFilter']).toBe('mine');
  wrapper.destroy();
});

test.each([
  [{ body: { code: 502, message: '添加被拒绝' } }, '添加被拒绝'],
  [null, '未能确认操作结果，请稍后刷新查看'],
])(
  'global addition %p keeps the modal open and displays the business result',
  async (addition, message) => {
    const { wrapper, store, api, messages } = setup(AddTracks, { addition });
    await store.dispatch('library/refreshPlaylists');
    await Vue.nextTick();
    await wrapper.find('.playlist').trigger('click');
    await flush();
    expect(store.state.modals.addTrackToPlaylistModal.show).toBe(true);
    expect(messages).toEqual([message]);
    expect(api.userPlaylist).toHaveBeenCalledTimes(1);
    wrapper.destroy();
  }
);

test('the visible toast keeps creation success and optional addition failure together', async () => {
  const { wrapper, store } = setup(NewPlaylist, {
    addition: { body: { code: 502, message: '无法添加歌曲' } },
  });
  await wrapper.find('button').trigger('click');
  await flush();
  expect(store.state.toast.text).toBe('成功创建歌单；无法添加歌曲');
  wrapper.destroy();
});
