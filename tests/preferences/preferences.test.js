import { createStore } from '@/store';

async function setup(settings = {}, data = {}, options = {}) {
  const values = {
    settings: JSON.stringify(settings),
    data: JSON.stringify(data),
  };
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const applyLanguage = jest.fn();
  const applyAppearance = jest.fn();
  const store = createStore({
    storage,
    language: 'zh-TW',
    preferences: { applyLanguage, applyAppearance },
    ...options,
  });
  await store.dispatch('preferences/applyRestored');
  applyLanguage.mockClear();
  applyAppearance.mockClear();
  storage.setItem.mockClear();
  return { store, storage, values, applyLanguage, applyAppearance };
}

test('完整设置动作更新公开读值与保存值，然后应用语言和主题', async () => {
  const { store, storage, values, applyLanguage, applyAppearance } =
    await setup();
  await store.dispatch('preferences/setLanguage', 'tr');
  expect(store.getters['preferences/settings'].lang).toBe('tr');
  expect(JSON.parse(values.settings).lang).toBe('tr');
  expect(applyLanguage).toHaveBeenCalledWith('tr');
  await store.dispatch('preferences/setAppearance', 'dark');
  await store.dispatch('preferences/setThemeColor', 'ocean');
  expect(applyAppearance).toHaveBeenLastCalledWith(
    expect.objectContaining({ appearance: 'dark', themeColor: 'ocean' })
  );
  expect(storage.setItem.mock.calls.every(([key]) => key === 'settings')).toBe(
    true
  );
});

test('恢复补默认值与快捷键并保留嵌套扩展；相同值与内存集合不重复保存', async () => {
  const { store, storage, values } = await setup(
    {
      proxyConfig: { server: 'saved', extension: { enabled: true } },
      shortcuts: [],
      extension: { ids: [1] },
    },
    { future: { token: 42 } }
  );
  expect(store.getters['preferences/settings']).toMatchObject({
    lang: 'zh-TW',
    proxyConfig: {
      protocol: 'noProxy',
      port: null,
      server: 'saved',
      extension: { enabled: true },
    },
  });
  expect(
    store.getters['preferences/settings'].shortcuts.length
  ).toBeGreaterThan(1);
  await store.dispatch('preferences/setPreference', {
    key: 'extension',
    value: { ids: [1] },
  });
  expect(storage.setItem).not.toHaveBeenCalled();
  await store.dispatch('preferences/setPreference', {
    key: 'extension',
    value: { ids: [1, 2] },
  });
  expect(JSON.parse(values.settings).extension).toEqual({ ids: [1, 2] });
  storage.setItem.mockClear();
  await store.dispatch('preferences/setLibraryPlaylistFilter', 'mine');
  expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual(['data']);
  expect(JSON.parse(values.data)).toMatchObject({
    future: { token: 42 },
    libraryPlaylistFilter: 'mine',
  });
  storage.setItem.mockClear();
  await store.dispatch('session/restore');
  expect(storage.setItem).not.toHaveBeenCalled();
});

test('纯数据操作不能绕过专用操作，并传播保存和效果异常', async () => {
  const { store, storage, applyLanguage } = await setup();
  await expect(
    store.dispatch('preferences/setPreference', { key: 'lang', value: 'tr' })
  ).rejects.toThrow('dedicated');
  storage.setItem.mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  await expect(store.dispatch('preferences/setLanguage', 'tr')).rejects.toThrow(
    'storage unavailable'
  );
  expect(applyLanguage).not.toHaveBeenCalled();
});

test('初始化只补有变化的投影；旧迁移后下一次恢复不重复保存', async () => {
  const first = await setup({ lyricsBackground: false });
  first.values.appVersion = '"0.3.9"';
  first.storage.setItem.mockClear();
  const migrated = createStore({ storage: first.storage });
  await migrated.dispatch('preferences/applyRestored');
  expect(migrated.getters['preferences/settings'].lyricsBackground).toBe(true);
  expect(first.storage.setItem.mock.calls.map(([key]) => key)).toEqual([
    'settings',
    'appVersion',
  ]);
  first.storage.setItem.mockClear();
  await createStore({ storage: first.storage }).dispatch(
    'preferences/applyRestored'
  );
  expect(first.storage.setItem).not.toHaveBeenCalled();
});

test('异步保存失败沿操作返回，重试相同配置仍会保存并等待效果', async () => {
  const { store, storage, applyLanguage } = await setup();
  storage.setItem.mockRejectedValueOnce(new Error('async storage unavailable'));
  await expect(store.dispatch('preferences/setLanguage', 'tr')).rejects.toThrow(
    'async storage unavailable'
  );
  expect(applyLanguage).not.toHaveBeenCalled();
  storage.setItem.mockResolvedValue(undefined);
  await store.dispatch('preferences/setLanguage', 'tr');
  expect(storage.setItem).toHaveBeenCalledTimes(2);
  expect(applyLanguage).toHaveBeenCalledWith('tr');
});

test('身份字段只写 data，收藏集合和二维码展示变化不写配置投影', async () => {
  const { store, storage, values } = await setup(
    {},
    { future: 'retained' },
    {
      session: {
        auth: {
          loginQrCodeKey: async () => ({
            code: 200,
            data: { unikey: 'qr-key' },
          }),
        },
        time: { schedule: () => 1, cancel: () => {} },
      },
      library: {
        api: {
          userPlaylist: async () => ({ playlist: [{ id: 12 }] }),
          getPlaylistDetail: async () => ({ playlist: { trackIds: [] } }),
        },
      },
    }
  );
  await store.dispatch('session/startQrLogin');
  expect(store.getters['session/qr'].url).toContain('qr-key');
  expect(storage.setItem).not.toHaveBeenCalled();
  await store.dispatch('session/selectPublicIdentity', {
    userId: 7,
    nickname: 'public',
    extension: { ids: [1] },
  });
  expect(JSON.parse(values.data)).toMatchObject({
    loginMode: 'username',
    user: { userId: 7 },
    likedSongPlaylistID: 12,
    future: 'retained',
  });
  expect(storage.setItem.mock.calls.every(([key]) => key === 'data')).toBe(
    true
  );
  storage.setItem.mockClear();
  await store.dispatch('library/refreshPlaylists');
  expect(store.getters['library/collections'].playlists).toEqual([{ id: 12 }]);
  expect(storage.setItem).not.toHaveBeenCalled();
  await store.dispatch('session/stopQrLogin');
});

test('分类和嵌套扩展数组保持使用者选择，嵌套提交保留未展示字段', async () => {
  const { store, values } = await setup({
    enabledPlaylistCategories: [],
    extension: { ids: [1, 2], hidden: true },
  });
  expect(
    store.getters['preferences/settings'].enabledPlaylistCategories
  ).toEqual([]);
  await store.dispatch('preferences/togglePlaylistCategory', '测试分类');
  expect(
    store.getters['preferences/settings'].enabledPlaylistCategories
  ).toEqual(['测试分类']);
  await store.dispatch('preferences/setPreference', {
    key: 'extension',
    value: { ids: [3] },
  });
  expect(JSON.parse(values.settings).extension).toEqual({
    ids: [3],
    hidden: true,
  });
});
