import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import mergeWith from 'lodash/mergeWith';
import defaults from './initLocalStorage';
import pkg from '../../package.json';

export function createPersistence(storage, language = 'en') {
  const version = storage.getItem('appVersion');
  const saved = {
    settings: JSON.parse(storage.getItem('settings')),
    data: JSON.parse(storage.getItem('data')),
  };
  const pending = {};
  let ready;
  const data = {
    ...cloneDeep(defaults.data),
    ...JSON.parse(storage.getItem('data')),
  };
  const restoredSettings = JSON.parse(storage.getItem('settings'));
  const settings = mergeWith(
    {},
    defaults.settings,
    restoredSettings,
    (previous, value) => (Array.isArray(value) ? cloneDeep(value) : undefined)
  );
  for (const key of [
    'unmSource',
    'unmProxyUri',
    'unmJooxCookie',
    'unmQQCookie',
    'unmYtDlExe',
  ]) {
    if (settings[key] === 0) settings[key] = '';
  }
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
  function write(key, value) {
    if (pending[key] && isEqual(pending[key].value, value))
      return pending[key].promise;
    if (!pending[key] && isEqual(saved[key], value)) return;
    const snapshot = cloneDeep(value);
    const perform = () => {
      const result = storage.setItem(key, JSON.stringify(snapshot));
      if (!result || typeof result.then !== 'function') {
        saved[key] = snapshot;
        return;
      }
      return Promise.resolve(result).then(() => {
        saved[key] = snapshot;
      });
    };
    const result = pending[key]
      ? pending[key].promise.catch(() => {}).then(perform)
      : perform();
    if (!result) return;
    const entry = { value: snapshot };
    entry.promise = result.finally(() => {
      if (pending[key] === entry) delete pending[key];
    });
    pending[key] = entry;
    return entry.promise;
  }
  const saveData = state =>
    write('data', {
      ...data,
      loginMode: state.session.loginMode,
      lastRefreshCookieDate: state.session.lastRefreshCookieDate,
      user: state.library.user,
      likedSongPlaylistID: state.library.likedSongPlaylistID,
      libraryPlaylistFilter: state.preferences.libraryPlaylistFilter,
    });
  const save = state =>
    Promise.all([
      write('settings', state.preferences.settings),
      saveData(state),
    ]).then(() => saved.settings);
  return {
    snapshot,
    save,
    get ready() {
      return ready;
    },
    install(store) {
      ready = save(store.state).then(() => {
        if (version !== JSON.stringify(pkg.version))
          return storage.setItem('appVersion', JSON.stringify(pkg.version));
      });
      ready.catch(() => {});
      store.subscribe((mutation, state) => {
        if (
          [
            'session/setIdentity',
            'session/setLastRefreshCookieDate',
            'library/setUser',
            'library/setLikedSongPlaylistID',
          ].includes(mutation.type)
        )
          Promise.resolve(saveData(state)).catch(() => {});
      });
    },
  };
}
