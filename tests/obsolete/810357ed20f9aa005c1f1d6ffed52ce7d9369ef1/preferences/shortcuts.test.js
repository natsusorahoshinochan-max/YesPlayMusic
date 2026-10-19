import { createStore } from '@/store';

function setup(settings = {}) {
  const values = { settings: JSON.stringify(settings) };
  const applyShortcuts = jest.fn();
  const applyTrayIconTheme = jest.fn();
  const store = createStore({
    storage: {
      getItem: key => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      },
    },
    preferences: { applyShortcuts, applyTrayIconTheme },
  });
  return { store, values, applyShortcuts, applyTrayIconTheme };
}

test('录制期间保存、普通设置、启用变更与默认恢复保持暂停，结束按当前启用配置恢复', async () => {
  const { store, values, applyShortcuts, applyTrayIconTheme } = setup();
  await store.dispatch('preferences/applyRestored');
  expect(applyShortcuts).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: true, recording: false }),
    true
  );
  expect(
    await store.dispatch('preferences/beginShortcutRecording', {
      id: 'play',
      type: 'globalShortcut',
    })
  ).toBe(true);
  await store.dispatch('preferences/saveShortcut', {
    id: 'play',
    type: 'globalShortcut',
    shortcut: 'Alt+P',
  });
  expect(
    JSON.parse(values.settings).shortcuts.find(s => s.id === 'play')
      .globalShortcut
  ).toBe('Alt+P');
  expect(applyShortcuts).toHaveBeenLastCalledWith(
    expect.objectContaining({ recording: true }),
    true
  );
  const count = applyShortcuts.mock.calls.length;
  await store.dispatch('preferences/setPreference', {
    key: 'future',
    value: 42,
  });
  expect(applyShortcuts).toHaveBeenCalledTimes(count);
  await store.dispatch('preferences/setGlobalShortcutsEnabled', false);
  await store.dispatch('preferences/restoreDefaultShortcuts');
  expect(applyShortcuts).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: false, recording: true }),
    true
  );
  await store.dispatch('preferences/endShortcutRecording');
  expect(applyShortcuts).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: false, recording: false }),
    false
  );
  expect(
    await store.dispatch('preferences/beginShortcutRecording', {
      id: 'play',
      type: 'globalShortcut',
    })
  ).toBe(false);
  await store.dispatch('preferences/setTrayIconTheme', 'light');
  expect(applyTrayIconTheme).toHaveBeenLastCalledWith('light');
  expect(JSON.parse(values.settings).trayIconTheme).toBe('light');
});

test('Electron 镜像只同步设置变化，生产 adapter 分别发送托盘与录制控制', async () => {
  const {
    createPreferenceEffects,
  } = require('@/application/preferenceEffects');
  const send = jest.fn();
  const previous = process.env;
  process.env = { ...previous, IS_ELECTRON: true };
  window.require = () => ({ ipcRenderer: { send } });
  try {
    const values = {};
    const store = createStore({
      storage: {
        getItem: key => values[key] ?? null,
        setItem: (key, value) => {
          values[key] = value;
        },
      },
      preferences: createPreferenceEffects({ getLocale: () => ({}) }),
    });
    send.mockClear();
    await store.dispatch('preferences/setLibraryPlaylistFilter', 'mine');
    expect(send).not.toHaveBeenCalled();
    await store.dispatch('preferences/setPreference', {
      key: 'future',
      value: 'value',
    });
    expect(send.mock.calls.map(([channel]) => channel)).toEqual(['settings']);
    send.mockClear();
    await store.dispatch('preferences/beginShortcutRecording', {
      id: 'play',
      type: 'shortcut',
    });
    expect(send).toHaveBeenLastCalledWith(
      'applyShortcuts',
      expect.objectContaining({ recording: true }),
      false
    );
    expect(send.mock.calls.some(([channel]) => channel === 'settings')).toBe(
      false
    );
    await store.dispatch('preferences/setTrayIconTheme', 'dark');
    expect(send).toHaveBeenLastCalledWith('updateTrayIcon', 'dark');
  } finally {
    process.env = previous;
    delete window.require;
  }
});

test('快捷键操作等待可报告的平台结果并传播异步错误，Web仍完成相同设置操作', async () => {
  const { store, applyShortcuts } = setup({ enableGlobalShortcut: false });
  let finish;
  applyShortcuts.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  let completed = false;
  const pending = store
    .dispatch('preferences/beginShortcutRecording', {
      id: 'play',
      type: 'shortcut',
    })
    .then(value => {
      completed = true;
      return value;
    });
  await Promise.resolve();
  expect(completed).toBe(false);
  finish();
  expect(await pending).toBe(true);
  applyShortcuts.mockRejectedValueOnce(new Error('platform unavailable'));
  await expect(
    store.dispatch('preferences/saveShortcut', {
      id: 'play',
      type: 'shortcut',
      shortcut: 'Alt+P',
    })
  ).rejects.toThrow('platform unavailable');
  await store.dispatch('preferences/endShortcutRecording');
  expect(applyShortcuts).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: false, recording: false }),
    false
  );
  const {
    createPreferenceEffects,
  } = require('@/application/preferenceEffects');
  const web = createStore({
    preferences: createPreferenceEffects({ getLocale: () => ({}) }),
  });
  await web.dispatch('preferences/setGlobalShortcutsEnabled', true);
  expect(
    await web.dispatch('preferences/beginShortcutRecording', {
      id: 'play',
      type: 'globalShortcut',
    })
  ).toBe(true);
  await web.dispatch('preferences/saveShortcut', {
    id: 'play',
    type: 'shortcut',
    shortcut: 'Shift+P',
  });
  expect(
    web.getters['preferences/settings'].shortcuts.find(s => s.id === 'play')
      .shortcut
  ).toBe('Shift+P');
  await web.dispatch('preferences/endShortcutRecording');
});
