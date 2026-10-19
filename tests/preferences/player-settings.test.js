import { createStore } from '@/store';

async function setup(settings = {}, effects = {}) {
  const values = { settings: JSON.stringify(settings) };
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const store = createStore({ storage, preferences: effects });
  await store.dispatch('preferences/applyRestored');
  storage.setItem.mockClear();
  return { store, values, storage };
}

test('实际音质变化转换并保存后清理缓存，相同音质不重复保存或清理', async () => {
  let store, values;
  const clearCache = jest.fn(() => {
    expect(store.getters['preferences/settings'].musicQuality).toBe(999000);
    expect(JSON.parse(values.settings).musicQuality).toBe(999000);
  });
  const setupResult = await setup({ musicQuality: 320000 }, { clearCache });
  ({ store, values } = setupResult);
  await store.dispatch('preferences/setMusicQuality', '999000');
  await store.dispatch('preferences/setMusicQuality', 999000);
  expect(clearCache).toHaveBeenCalledTimes(1);
  expect(setupResult.storage.setItem).toHaveBeenCalledTimes(1);
});

test('输出设备更新并保存后应用，操作等待设备完成并传播失败', async () => {
  let finish;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  let store, values;
  const applyOutputDevice = jest.fn(() => {
    expect(store.getters['preferences/settings'].outputDevice).toBe('speaker');
    expect(JSON.parse(values.settings).outputDevice).toBe('speaker');
    return pending;
  });
  // 启动应用也使用相同效果；先提供已连接的播放器效果。
  applyOutputDevice.mockImplementationOnce(() => {});
  ({ store, values } = await setup({}, { applyOutputDevice }));
  let completed = false;
  const operation = store
    .dispatch('preferences/setOutputDevice', 'speaker')
    .then(() => {
      completed = true;
    });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  expect(applyOutputDevice).toHaveBeenCalledTimes(2);
  finish();
  await operation;
  applyOutputDevice.mockRejectedValueOnce(new Error('device unavailable'));
  await expect(
    store.dispatch('preferences/setOutputDevice', 'other')
  ).rejects.toThrow('device unavailable');
});

test('启动不清理缓存或复位倒放；关闭开关先保存再执行变更效果', async () => {
  let store, values;
  const clearCache = jest.fn(() => {
    expect(store.getters['preferences/settings'].automaticallyCacheSongs).toBe(
      false
    );
    expect(JSON.parse(values.settings).automaticallyCacheSongs).toBe(false);
  });
  const resetReversedMode = jest.fn(() => {
    expect(store.getters['preferences/settings'].enableReversedMode).toBe(
      false
    );
    expect(JSON.parse(values.settings).enableReversedMode).toBe(false);
  });
  ({ store, values } = await setup(
    {
      musicQuality: 999000,
      automaticallyCacheSongs: true,
      enableReversedMode: true,
    },
    { clearCache, resetReversedMode }
  ));
  expect(clearCache).not.toHaveBeenCalled();
  expect(resetReversedMode).not.toHaveBeenCalled();
  await store.dispatch('preferences/setAutomaticCaching', false);
  await store.dispatch('preferences/setReversedModeEnabled', false);
  expect(clearCache).toHaveBeenCalledTimes(1);
  expect(resetReversedMode).toHaveBeenCalledTimes(1);
  await store.dispatch('preferences/setAutomaticCaching', true);
  await store.dispatch('preferences/setReversedModeEnabled', true);
  expect(clearCache).toHaveBeenCalledTimes(1);
  expect(resetReversedMode).toHaveBeenCalledTimes(1);
  clearCache.mockRejectedValueOnce(new Error('cache unavailable'));
  await expect(
    store.dispatch('preferences/setAutomaticCaching', false)
  ).rejects.toThrow('cache unavailable');
});

test('无损音质保留 flac 配置值', async () => {
  const { store, values } = await setup();
  await store.dispatch('preferences/setMusicQuality', 'flac');
  expect(store.getters['preferences/settings'].musicQuality).toBe('flac');
  expect(JSON.parse(values.settings).musicQuality).toBe('flac');
});

test('恢复旧的字符串音质后再次选择同一音质不清理缓存', async () => {
  const clearCache = jest.fn();
  const { store } = await setup({ musicQuality: '320000' }, { clearCache });
  await store.dispatch('preferences/setMusicQuality', '320000');
  expect(clearCache).not.toHaveBeenCalled();
});
