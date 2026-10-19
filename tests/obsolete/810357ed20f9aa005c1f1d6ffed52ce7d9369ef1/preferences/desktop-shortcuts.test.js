import { shallowMount } from '@vue/test-utils';
import Settings from '@/views/settings.vue';
import { EventEmitter } from 'events';
import { createStore } from '@/store';
import { createPreferenceEffects } from '@/application/preferenceEffects';
import { initIpcMain } from '@/electron/ipcMain';
import { globalShortcut, Menu, ipcMain } from 'electron';

jest.mock(
  'dexie',
  () =>
    class {
      constructor() {
        this.trackSources = { each: () => Promise.resolve() };
      }
      version() {
        return { stores: () => ({ upgrade() {} }) };
      }
    }
);

jest.mock(
  'electron',
  () => ({
    app: { name: 'YesPlayMusic', getPath: () => '' },
    dialog: {},
    ipcMain: Object.assign(new (require('events').EventEmitter)(), {
      handle: jest.fn(),
    }),
    globalShortcut: { register: jest.fn(), unregisterAll: jest.fn() },
    Menu: {
      buildFromTemplate: jest.fn(template => template),
      setApplicationMenu: jest.fn(),
    },
  }),
  { virtual: true }
);
jest.mock('@unblockneteasemusic/rust-napi', () => ({ Executor: class {} }));

function desktop() {
  const values = {};
  const mainStore = {
    get: key => key.split('.').reduce((value, part) => value?.[part], values),
    set: (key, value) => {
      values[key] = value;
    },
  };
  const win = { webContents: { send: jest.fn() } };
  const tray = new EventEmitter();
  initIpcMain(win, mainStore, tray);
  const environment = process.env;
  process.env = { ...environment, IS_ELECTRON: true };
  window.require = () => ({
    ipcRenderer: {
      send: (channel, ...args) => ipcMain.emit(channel, {}, ...args),
    },
  });
  const storageValues = {};
  const store = createStore({
    storage: {
      getItem: key => storageValues[key] ?? null,
      setItem: (key, value) => {
        storageValues[key] = value;
      },
    },
    preferences: createPreferenceEffects({ getLocale: () => ({}) }),
  });
  return {
    store,
    tray,
    restore() {
      process.env = environment;
      delete window.require;
      ipcMain.removeAllListeners();
    },
  };
}

test('桌面IPC镜像不注册快捷键；保存与默认恢复更新菜单但录制期间平台持续暂停', async () => {
  const { store, restore } = desktop();
  try {
    expect(globalShortcut.register).not.toHaveBeenCalled();
    await store.dispatch('preferences/setGlobalShortcutsEnabled', true);
    expect(globalShortcut.register).toHaveBeenCalled();
    await store.dispatch('preferences/beginShortcutRecording', {
      id: 'play',
      type: 'shortcut',
    });
    globalShortcut.register.mockClear();
    await store.dispatch('preferences/saveShortcut', {
      id: 'play',
      type: 'shortcut',
      shortcut: 'Alt+P',
    });
    expect(Menu.setApplicationMenu).toHaveBeenCalled();
    await store.dispatch('preferences/setPreference', {
      key: 'future',
      value: 1,
    });
    await store.dispatch('preferences/restoreDefaultShortcuts');
    expect(globalShortcut.register).not.toHaveBeenCalled();
    await store.dispatch('preferences/endShortcutRecording');
    expect(globalShortcut.register).toHaveBeenCalled();
  } finally {
    restore();
  }
});

test('真实设置页面在桌面录制期间修改语言和恢复默认仍暂停，离开后恢复当前配置', async () => {
  navigator.mediaDevices = { enumerateDevices: async () => [] };
  const { store, restore } = desktop();
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  let wrapper;
  try {
    wrapper = shallowMount(Settings, {
      store,
      mocks: { $t: key => key },
      stubs: ['router-link', 'svg-icon'],
    });
    await store.dispatch('preferences/setGlobalShortcutsEnabled', true);
    await wrapper.find('.keyboard-input').trigger('click');
    await flush();
    globalShortcut.register.mockClear();
    await wrapper.findAll('select').at(0).setValue('tr');
    await flush();
    expect(store.getters['preferences/settings'].lang).toBe('tr');
    await wrapper.find('.restore-default-shortcut').trigger('click');
    await flush();
    expect(globalShortcut.register).not.toHaveBeenCalled();
    wrapper.destroy();
    wrapper = null;
    await flush();
    expect(globalShortcut.register).toHaveBeenCalled();
  } finally {
    wrapper?.destroy();
    restore();
  }
});
