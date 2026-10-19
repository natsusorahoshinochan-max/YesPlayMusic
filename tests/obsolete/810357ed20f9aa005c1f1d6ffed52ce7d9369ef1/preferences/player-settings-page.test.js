import { shallowMount, createLocalVue } from '@vue/test-utils';
import Vuex from 'vuex';
import Settings from '@/views/settings.vue';
import { createStore } from '@/store';
import { createPreferenceEffects } from '@/application/preferenceEffects';
import { startApplication } from '@/application/startup';

const mockClear = jest.fn(() => Promise.resolve());
const mockCount = jest.fn(callback => {
  callback({ source: { byteLength: 1024 } });
  return Promise.resolve();
});
jest.mock(
  'dexie',
  () =>
    class {
      constructor() {
        this.tables = [{ clear: () => mockClear() }];
        this.trackSources = { each: callback => mockCount(callback) };
      }
      version() {
        return { stores: () => ({ upgrade: () => {} }) };
      }
    }
);

async function setup(desktop = false) {
  const values = {};
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
  const player = { setOutputDevice: jest.fn(), reversed: true };
  const notices = [];
  const store = createStore({
    storage,
    preferences: createPreferenceEffects({
      getLocale: () => ({}),
      getPlayer: () => player,
    }),
    actions: { showToast: (context, message) => notices.push(message) },
  });
  window.matchMedia = () => ({ matches: false });
  document.head.innerHTML = '<meta name="theme-color" content="#fff">';
  await store.dispatch('preferences/applyRestored');
  const localVue = createLocalVue();
  localVue.use(Vuex);
  const wrapper = shallowMount(Settings, {
    localVue,
    store,
    computed: { isElectron: () => desktop },
    mocks: { $t: key => key },
    stubs: ['router-link', 'svg-icon'],
  });
  return { store, values, wrapper, player, notices };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('设置页音质选择经完整操作等待缓存清理，再更新缓存展示并提示清理失败', async () => {
  const { wrapper, values, notices } = await setup();
  let finish;
  mockClear.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  await wrapper.findAll('select').at(4).setValue('999000');
  await settle();
  expect(JSON.parse(values.settings).musicQuality).toBe(999000);
  expect(mockClear).toHaveBeenCalledTimes(1);
  const queriesBeforeCompletion = mockCount.mock.calls.length;
  finish();
  await settle();
  expect(mockCount.mock.calls.length).toBe(queriesBeforeCompletion + 1);
  expect(wrapper.text()).toContain('settings.musicQuality.text');
  mockClear.mockRejectedValueOnce(new Error('cache unavailable'));
  await wrapper.findAll('select').at(4).setValue('flac');
  await settle();
  expect(notices).toEqual(['cache unavailable']);
  wrapper.destroy();
});

test('倒放控件只提交完整设置操作，由生产效果复位 Player', async () => {
  const { wrapper, store, values, player } = await setup();
  await wrapper.find('#enable-reversed-mode').setChecked(true);
  await settle();
  await wrapper.find('#enable-reversed-mode').setChecked(false);
  await settle();
  expect(store.getters['preferences/settings'].enableReversedMode).toBe(false);
  expect(JSON.parse(values.settings).enableReversedMode).toBe(false);
  expect(player.reversed).toBe(false);
  wrapper.destroy();
});

test('桌面设备与自动缓存控件经完整操作应用并保存', async () => {
  const { wrapper, player, values, notices } = await setup(true);
  await wrapper.setData({
    allOutputDevices: [
      { deviceId: 'default', label: 'Default' },
      { deviceId: 'speaker', label: 'Speaker' },
    ],
  });
  const deviceSelect = wrapper
    .findAll('select')
    .wrappers.find(select => select.find('option[value="speaker"]').exists());
  player.setOutputDevice.mockRejectedValueOnce(
    new Error('speaker unavailable')
  );
  await deviceSelect.setValue('speaker');
  await settle();
  expect(JSON.parse(values.settings).outputDevice).toBe('speaker');
  expect(notices).toEqual(['speaker unavailable']);
  await wrapper.find('#automatically-cache-songs').setChecked(false);
  await settle();
  expect(JSON.parse(values.settings).automaticallyCacheSongs).toBe(false);
  expect(mockClear).toHaveBeenCalledTimes(1);
  wrapper.destroy();
});

test('启动在 Player 接线后恢复设备并等待完成；恢复关闭配置不执行变更动作', async () => {
  const values = {
    settings: JSON.stringify({
      musicQuality: 'flac',
      outputDevice: 'speaker',
      automaticallyCacheSongs: false,
      enableReversedMode: false,
    }),
  };
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
  let finish, store;
  const player = {
    reversed: true,
    setOutputDevice: jest.fn(() => {
      expect(store.state.player).toBe(player);
      expect(store.getters['preferences/settings'].outputDevice).toBe(
        'speaker'
      );
      return new Promise(resolve => {
        finish = resolve;
      });
    }),
  };
  const mount = jest.fn();
  window.matchMedia = () => ({ matches: false });
  document.head.innerHTML = '<meta name="theme-color" content="#fff">';
  const started = startApplication({
    createStore: () =>
      (store = createStore({
        storage,
        preferences: createPreferenceEffects({
          getLocale: () => ({}),
          getPlayer: () => store.state.player,
        }),
      })),
    initializeLocale: () => ({}),
    configureRequest: () => {},
    createPlayer: () => player,
    initializeAppearance: () => {},
    mount,
  });
  await settle();
  expect(mount).not.toHaveBeenCalled();
  finish();
  await started;
  expect(mount).toHaveBeenCalledTimes(1);
  expect(mockClear).not.toHaveBeenCalled();
  expect(player.reversed).toBe(true);
});
