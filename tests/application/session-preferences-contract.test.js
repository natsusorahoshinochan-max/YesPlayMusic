import { createStore } from '@/store';
import { startApplication } from '@/application/startup';

function memoryStorage(values = {}) {
  const entries = new Map(
    Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)])
  );
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: jest.fn((key, value) => entries.set(key, value)),
    read: key => JSON.parse(entries.get(key) ?? 'null'),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup({
  settings = {},
  data = {},
  credential = null,
  api: apiOverrides = {},
  auth: authOverrides = {},
  storage: suppliedStorage,
  preferences = {},
} = {}) {
  const storage = suppliedStorage || memoryStorage({ settings, data });
  const credentialValues = new Map(credential ? [['MUSIC_U', credential]] : []);
  const credentials = {
    get: key => credentialValues.get(key),
    set: jest.fn(cookie => credentialValues.set('MUSIC_U', cookie)),
    remove: jest.fn(key => credentialValues.delete(key)),
  };
  const api = {
    userAccount: jest.fn(async () => ({ code: 200, profile: { userId: 42 } })),
    userPlaylist: jest.fn(async () => ({ playlist: [{ id: 90 }] })),
    getPlaylistDetail: jest.fn(async () => ({
      playlist: { id: 90, trackIds: [{ id: 7 }, { id: 8 }] },
    })),
    getTrackDetail: jest.fn(async () => ({ songs: [{ id: 7 }, { id: 8 }] })),
    userLikedSongsIDs: jest.fn(async () => ({ ids: [7, 8] })),
    likedAlbums: jest.fn(async () => ({ data: [] })),
    likedArtists: jest.fn(async () => ({ data: [] })),
    likedMVs: jest.fn(async () => ({ data: [] })),
    cloudDisk: jest.fn(async () => ({ data: [] })),
    ...apiOverrides,
  };
  const effects = Object.fromEntries(
    [
      'applyLanguage',
      'applyAppearance',
      'applyOutputDevice',
      'applyProxy',
      'applyTrayIconTheme',
      'applyShortcuts',
      'clearCache',
      'resetReversedMode',
    ].map(name => [name, jest.fn()])
  );
  const navigate = jest.fn();
  const notify = jest.fn();
  const time = { schedule: jest.fn(() => 11), cancel: jest.fn() };
  const auth = {
    loginWithEmail: jest.fn(async () => ({
      code: 200,
      cookie: 'account-cookie',
    })),
    loginQrCodeKey: jest.fn(async () => ({
      code: 200,
      data: { unikey: 'qr-key' },
    })),
    logout: jest.fn(async () => {}),
    ...authOverrides,
  };
  const store = createStore({
    storage,
    language: 'zh-TW',
    credentials,
    session: { auth, navigate, notify, time },
    library: { api },
    preferences: { ...effects, ...preferences },
  });
  await store.dispatch('preferences/applyRestored');
  storage.setItem.mockClear();
  Object.values(effects).forEach(effect => effect.mockClear());
  return {
    store,
    storage,
    api,
    auth,
    credentials,
    effects,
    navigate,
    notify,
    time,
  };
}

const settingsOf = store => store.getters['preferences/settings'];
const persistedKeys = storage => storage.setItem.mock.calls.map(([key]) => key);

describe('session and preferences public contracts (#1 and #8)', () => {
  test('visitor, public identity and authenticated account expose consistent capabilities', async () => {
    for (const [data, credential, account, library] of [
      [{}, null, false, false],
      [{ loginMode: 'username', user: { userId: 42 } }, null, false, true],
      [{ loginMode: 'account', user: { userId: 42 } }, 'valid', true, true],
      [{ loginMode: 'account', user: { userId: 42 } }, null, false, false],
    ]) {
      const { store, api } = await setup({ data, credential });
      await store.dispatch('session/restore');
      expect(store.getters['session/hasAccount']).toBe(account);
      expect(store.getters['session/hasLibraryIdentity']).toBe(library);
      expect(api.userAccount).not.toHaveBeenCalled();
    }
  });

  test('password login owns credentials and resolves with the liked-song preview ready', async () => {
    const tracks = deferred();
    const { store, credentials, navigate, api } = await setup({
      api: { getTrackDetail: jest.fn(() => tracks.promise) },
    });
    let completed = false;
    const login = store
      .dispatch('session/loginWithPassword', {
        mode: 'email',
        email: ' listener@example.com ',
        password: 'secret',
      })
      .then(() => {
        completed = true;
      });
    // Let the controlled request pipeline reach the preview's remote boundary.
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    expect(api.getTrackDetail).toHaveBeenCalledWith('7,8');
    expect(completed).toBe(false);
    tracks.resolve({ songs: [{ id: 7 }, { id: 8 }] });
    await login;
    expect(credentials.get('MUSIC_U')).toBe('account-cookie');
    expect(store.getters['session/hasAccount']).toBe(true);
    expect(store.getters['library/user']).toEqual({ userId: 42 });
    expect(store.getters['library/previewReady']).toBe(true);
    expect(store.getters['library/collections'].songsWithDetails).toEqual([
      { id: 7 },
      { id: 8 },
    ]);
    expect(navigate).toHaveBeenCalledWith('account');
  });

  test('public identity selection loads public playlists and preview without account requests', async () => {
    const { store, api, navigate } = await setup();
    await store.dispatch('session/selectPublicIdentity', {
      userId: 73,
      nickname: 'Public',
    });
    expect(store.getters['session/hasAccount']).toBe(false);
    expect(store.getters['session/hasLibraryIdentity']).toBe(true);
    expect(store.getters['library/user'].userId).toBe(73);
    expect(store.getters['library/collections'].songs).toEqual([7, 8]);
    expect(store.getters['library/previewReady']).toBe(true);
    expect(api.userPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 73 })
    );
    expect(api.userAccount).not.toHaveBeenCalled();
    expect(api.userLikedSongsIDs).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('publicIdentity');
  });

  test('logout and invalidation clear the Netease identity while preserving preferences and Last.fm', async () => {
    for (const action of ['logout', 'invalidate']) {
      const lastfm = { key: 'independent-session', username: 'scrobbler' };
      const storage = memoryStorage({
        data: {
          loginMode: 'account',
          user: { userId: 42 },
          likedSongPlaylistID: 90,
        },
        settings: { themeColor: 'violet', customSetting: { enabled: true } },
        lastfm,
      });
      const { store, credentials, navigate, notify } = await setup({
        storage,
        credential: 'valid',
      });
      const before = JSON.parse(JSON.stringify(settingsOf(store)));
      await store.dispatch(`session/${action}`, {
        ownership: store.getters['session/ownership'],
      });
      expect(store.getters['session/hasLibraryIdentity']).toBe(false);
      expect(store.getters['session/hasAccount']).toBe(false);
      expect(store.getters['library/user']).toEqual({});
      expect(credentials.get('MUSIC_U')).toBeUndefined();
      expect(settingsOf(store)).toEqual(before);
      expect(storage.read('settings')).toEqual(before);
      expect(store.getters['lastfm/authorization']).toEqual(lastfm);
      expect(storage.read('lastfm')).toEqual(lastfm);
      expect(navigate).toHaveBeenCalledWith(
        action === 'logout' ? 'logout' : 'invalidated'
      );
      if (action === 'invalidate') expect(notify).toHaveBeenCalled();
    }
  });

  test('dedicated setting operations save and apply the same public values, awaiting adapter completion', async () => {
    const output = deferred();
    let observeOutput;
    const { store, storage, effects } = await setup({
      preferences: {
        applyOutputDevice: () => {
          if (!observeOutput) return;
          observeOutput();
          return output.promise;
        },
      },
    });
    await store.dispatch('preferences/setLanguage', 'tr');
    await store.dispatch('preferences/setAppearance', 'dark');
    await store.dispatch('preferences/setThemeColor', 'violet');
    expect(effects.applyLanguage).toHaveBeenCalledWith('tr');
    expect(effects.applyAppearance).toHaveBeenLastCalledWith(
      expect.objectContaining({ appearance: 'dark', themeColor: 'violet' })
    );
    observeOutput = () => {
      expect(settingsOf(store).outputDevice).toBe('speaker-2');
      expect(storage.read('settings').outputDevice).toBe('speaker-2');
    };
    let completed = false;
    const operation = store
      .dispatch('preferences/setOutputDevice', 'speaker-2')
      .then(() => {
        completed = true;
      });
    await Promise.resolve();
    expect(completed).toBe(false);
    output.resolve();
    await operation;
    expect(storage.read('settings')).toEqual(settingsOf(store));
    expect(new Set(persistedKeys(storage))).toEqual(new Set(['settings']));
    await expect(
      store.dispatch('preferences/setPreference', {
        key: 'musicQuality',
        value: 'flac',
      })
    ).rejects.toThrow();
  });

  test('unchanged settings and quality avoid writes and cache clearing; a quality change clears cache', async () => {
    const { store, storage, effects } = await setup();
    await store.dispatch(
      'preferences/setMusicQuality',
      String(settingsOf(store).musicQuality)
    );
    await store.dispatch(
      'preferences/setThemeColor',
      settingsOf(store).themeColor
    );
    expect(persistedKeys(storage)).toEqual([]);
    expect(effects.clearCache).not.toHaveBeenCalled();
    await store.dispatch('preferences/setMusicQuality', 'flac');
    expect(storage.read('settings').musicQuality).toBe('flac');
    expect(effects.clearCache).toHaveBeenCalledTimes(1);
    expect(persistedKeys(storage)).toEqual(['settings']);
  });

  test('filter changes write only data and memory collections and QR display do not save', async () => {
    const { store, storage, time } = await setup({
      data: {
        loginMode: 'username',
        user: { userId: 73 },
        likedSongPlaylistID: 90,
      },
    });
    await store.dispatch('preferences/setLibraryPlaylistFilter', 'createdByMe');
    expect(persistedKeys(storage)).toEqual(['data']);
    expect(storage.read('data').libraryPlaylistFilter).toBe('createdByMe');
    storage.setItem.mockClear();
    await store.dispatch('library/loadApplication');
    await store.dispatch('session/startQrLogin');
    expect(store.getters['session/qr'].url).toContain('qr-key');
    expect(store.getters['library/collections'].songsWithDetails).toHaveLength(
      2
    );
    expect(persistedKeys(storage)).toEqual([]);
    await store.dispatch('session/stopQrLogin');
    expect(time.cancel).toHaveBeenCalledWith(11);
  });

  test('nested extension settings, dynamic fields and unknown data survive subsequent saves', async () => {
    const { store, storage } = await setup({
      settings: {
        extension: { hidden: { token: 'keep' }, visible: 1 },
        proxyConfig: { protocol: 'noProxy', futureOption: { mode: 'keep' } },
      },
      data: { extensionData: { revision: 3 } },
    });
    await store.dispatch('preferences/setPreference', {
      key: 'extension',
      value: { visible: 2 },
    });
    await store.dispatch('preferences/setPreference', {
      key: 'futureDynamic',
      value: { list: [1, 2] },
    });
    await store.dispatch('preferences/submitProxy', {
      protocol: 'http',
      server: 'localhost',
      port: '7890',
    });
    await store.dispatch('preferences/setLibraryPlaylistFilter', 'subscribed');
    expect(storage.read('settings').extension).toEqual({
      hidden: { token: 'keep' },
      visible: 2,
    });
    expect(storage.read('settings').futureDynamic).toEqual({ list: [1, 2] });
    expect(storage.read('settings').proxyConfig).toEqual({
      protocol: 'http',
      server: 'localhost',
      port: 7890,
      futureOption: { mode: 'keep' },
    });
    expect(storage.read('data').extensionData).toEqual({ revision: 3 });
  });

  test('recording stays paused through save, ordinary setting changes and shortcut restoration', async () => {
    const { store, effects, storage } = await setup();
    expect(
      await store.dispatch('preferences/beginShortcutRecording', {
        id: 'play',
        type: 'globalShortcut',
      })
    ).toBe(true);
    await store.dispatch('preferences/saveShortcut', {
      id: 'play',
      type: 'globalShortcut',
      shortcut: 'Alt+X',
    });
    expect(
      storage.read('settings').shortcuts.find(item => item.id === 'play')
        .globalShortcut
    ).toBe('Alt+X');
    const count = effects.applyShortcuts.mock.calls.length;
    await store.dispatch('preferences/setPreference', {
      key: 'lyricFontSize',
      value: 32,
    });
    expect(effects.applyShortcuts).toHaveBeenCalledTimes(count);
    await store.dispatch('preferences/restoreDefaultShortcuts');
    expect(
      effects.applyShortcuts.mock.calls.every(([control]) => control.recording)
    ).toBe(true);
    await store.dispatch('preferences/setGlobalShortcutsEnabled', false);
    await store.dispatch('preferences/endShortcutRecording');
    expect(effects.applyShortcuts).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, recording: false }),
      false
    );
    expect(
      await store.dispatch('preferences/beginShortcutRecording', {
        id: 'play',
        type: 'globalShortcut',
      })
    ).toBe(false);
  });

  test('proxy submissions apply repeatedly while unchanged values are saved once', async () => {
    const { store, storage, effects } = await setup();
    const config = { protocol: 'http', server: '127.0.0.1', port: '8080' };
    await store.dispatch('preferences/submitProxy', config);
    await store.dispatch('preferences/submitProxy', config);
    expect(persistedKeys(storage)).toEqual(['settings']);
    expect(effects.applyProxy).toHaveBeenCalledTimes(2);
    expect(effects.applyProxy).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 8080, protocol: 'http' })
    );
    await store.dispatch('preferences/disableProxy');
    expect(storage.read('settings').proxyConfig.protocol).toBe('noProxy');
    expect(effects.applyProxy).toHaveBeenLastCalledWith(
      expect.objectContaining({ protocol: 'noProxy' })
    );
  });

  test('startup restores normalized configuration with wired dependencies and no quality cache clearing', async () => {
    const storage = memoryStorage({
      appVersion: '0.3.9',
      settings: {
        lang: null,
        musicQuality: 'flac',
        lyricsBackground: false,
        shortcuts: [{ id: 'play', shortcut: 'Alt+P', globalShortcut: 'Alt+P' }],
      },
      data: { user: { userId: 73 }, loginMode: 'username' },
    });
    const clearCache = jest.fn();
    let dependenciesReady = false;
    let player;
    const applyOutputDevice = jest.fn(() => {
      expect(dependenciesReady).toBe(true);
      expect(player).toBeDefined();
    });
    const applyLanguage = jest.fn();
    const applyProxy = jest.fn();
    const mount = jest.fn(({ store }) => store);
    const store = await startApplication({
      createStore: () =>
        createStore({
          storage,
          language: 'zh-TW',
          preferences: {
            clearCache,
            applyOutputDevice,
            applyLanguage,
            applyProxy,
          },
        }),
      initializeLocale: language => {
        expect(language).toBe('zh-TW');
        return { locale: language };
      },
      configureRequest: options => {
        expect(options.getSettings().musicQuality).toBe('flac');
      },
      initializeDependencies: () => {
        dependenciesReady = true;
      },
      createPlayer: () => {
        player = {};
        return player;
      },
      initializeAppearance: jest.fn(),
      mount,
    });
    expect(settingsOf(store).lyricsBackground).toBe(true);
    expect(
      settingsOf(store).shortcuts.find(item => item.id === 'play').shortcut
    ).toBe('Alt+P');
    expect(settingsOf(store).shortcuts.some(item => item.id === 'next')).toBe(
      true
    );
    expect(applyOutputDevice).toHaveBeenCalledTimes(1);
    expect(applyLanguage).toHaveBeenCalledWith('zh-TW');
    expect(clearCache).not.toHaveBeenCalled();
    expect(applyProxy).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalled();
  });
});
