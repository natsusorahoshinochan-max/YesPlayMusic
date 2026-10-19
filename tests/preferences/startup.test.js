import { createStore } from '@/store';
import { startApplication } from '@/application/startup';

test('恢复配置在 locale、请求环境与 Player 接线后应用，完成后才挂载', async () => {
  const events = [];
  const settings = { lang: 'tr', appearance: 'dark', themeColor: 'ocean' };
  const values = { settings: JSON.stringify(settings) };
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
  let store;
  const i18n = { locale: '' };
  const player = {};
  const mounted = await startApplication({
    createStore: () =>
      (store = createStore({
        storage,
        preferences: {
          applyLanguage: lang => {
            expect(store.state.player).toBe(player);
            i18n.locale = lang;
            events.push('language');
          },
          applyAppearance: restored => {
            expect(restored).toMatchObject(settings);
            events.push('appearance');
          },
        },
      })),
    initializeLocale: lang => {
      i18n.locale = lang;
      events.push('locale');
      return i18n;
    },
    configureRequest: () => events.push('request'),
    createPlayer: () => {
      events.push('player');
      return player;
    },
    initializeAppearance: () => events.push('listener'),
    mount: () => {
      events.push('mount');
      return 'mounted';
    },
  });
  expect(mounted).toBe('mounted');
  expect(events).toEqual([
    'locale',
    'request',
    'player',
    'language',
    'appearance',
    'listener',
    'mount',
  ]);
});

test.each(['settings', 'appVersion'])(
  '初始化 %s 保存失败时启动拒绝，迁移失败不提前更新版本',
  async failureKey => {
    const values = {
      appVersion: '"0.3.9"',
      settings: JSON.stringify({ lyricsBackground: false }),
    };
    const storage = {
      getItem: key => values[key] ?? null,
      setItem: jest.fn((key, value) => {
        if (key === failureKey)
          return Promise.reject(new Error(`failed ${key}`));
        values[key] = value;
      }),
    };
    const mount = jest.fn();
    await expect(
      startApplication({
        createStore: () => createStore({ storage }),
        initializeLocale: () => ({}),
        configureRequest: () => {},
        createPlayer: () => ({}),
        initializeAppearance: () => {},
        mount,
      })
    ).rejects.toThrow(`failed ${failureKey}`);
    expect(mount).not.toHaveBeenCalled();
    if (failureKey === 'settings') expect(values.appVersion).toBe('"0.3.9"');
  }
);
