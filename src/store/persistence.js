import cloneDeep from 'lodash/cloneDeep';
import defaults from './initLocalStorage';
import pkg from '../../package.json';

export function createPersistence(storage, language = 'en') {
  const version = storage.getItem('appVersion');
  const data = {
    ...cloneDeep(defaults.data),
    ...JSON.parse(storage.getItem('data')),
  };
  const settings = {
    ...cloneDeep(defaults.settings),
    ...JSON.parse(storage.getItem('settings')),
  };
  const missingShortcuts = defaults.settings.shortcuts.filter(
    shortcut =>
      !settings.shortcuts.some(existing => existing.id === shortcut.id)
  );
  settings.shortcuts.push(...cloneDeep(missingShortcuts));
  if (version === '"0.3.9"') settings.lyricsBackground = true;
  if (settings.lang == null) {
    const languages = { zh: 'zh-CN', 'zh-TW': 'zh-TW', en: 'en', tr: 'tr' };
    settings.lang =
      languages[language] || languages[language.slice(0, 2)] || 'en';
  }
  const snapshot = {
    session: {
      loginMode: data.loginMode,
      lastRefreshCookieDate: data.lastRefreshCookieDate,
    },
    library: { user: data.user, likedSongPlaylistID: data.likedSongPlaylistID },
    preferences: {
      settings,
      libraryPlaylistFilter: data.libraryPlaylistFilter ?? 'all',
    },
  };
  const write = state => {
    storage.setItem('settings', JSON.stringify(state.preferences.settings));
    storage.setItem(
      'data',
      JSON.stringify({
        ...data,
        loginMode: state.session.loginMode,
        lastRefreshCookieDate: state.session.lastRefreshCookieDate,
        user: state.library.user,
        likedSongPlaylistID: state.library.likedSongPlaylistID,
        libraryPlaylistFilter: state.preferences.libraryPlaylistFilter,
      })
    );
  };
  return {
    snapshot,
    install(store) {
      write(store.state);
      storage.setItem('appVersion', JSON.stringify(pkg.version));
      store.subscribe((mutation, state) => {
        if (/^(preferences|session|library)\//.test(mutation.type))
          write(state);
      });
    },
  };
}
