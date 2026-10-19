import Vue from 'vue';
import shortcuts from '@/utils/shortcuts';
import cloneDeep from 'lodash/cloneDeep';
import mergeWith from 'lodash/mergeWith';
import isPlainObject from 'lodash/isPlainObject';

export default function createPreferences(
  snapshot,
  {
    persist = () => {},
    applyLanguage = () => {},
    applyAppearance = () => {},
    applyShortcuts = () => {},
    applyTrayIconTheme = () => {},
  } = {}
) {
  const shortcutControl = state => ({
    enabled: state.settings.enableGlobalShortcut !== false,
    recording: state.shortcutRecording !== null,
    shortcuts: cloneDeep(state.settings.shortcuts),
  });
  return {
    namespaced: true,
    state: () => ({
      settings: snapshot.settings,
      shortcutRecording: null,
      libraryPlaylistFilter: snapshot.libraryPlaylistFilter,
    }),
    getters: {
      settings: state => state.settings,
      libraryPlaylistFilter: state => state.libraryPlaylistFilter,
    },
    actions: {
      async setPreference({ commit, state }, { key, value }) {
        const dedicated = [
          'lang',
          'appearance',
          'themeColor',
          'trayIconTheme',
          'musicQuality',
          'outputDevice',
          'automaticallyCacheSongs',
          'enableReversedMode',
          'enableGlobalShortcut',
          'proxyConfig',
          'shortcuts',
        ];
        if (dedicated.includes(key))
          throw new Error(`Use the dedicated preference action for ${key}`);
        if (
          [
            'unmSource',
            'unmProxyUri',
            'unmJooxCookie',
            'unmQQCookie',
            'unmYtDlExe',
          ].includes(key)
        )
          value = value.length ? value : 0;
        if (key === 'unmEnableFlac') value = value || false;
        if (isPlainObject(value))
          value = mergeWith({}, state.settings[key], value, (previous, next) =>
            Array.isArray(next) ? cloneDeep(next) : undefined
          );
        commit('updateSettings', { key, value: cloneDeep(value) });
        await persist();
      },
      async togglePlaylistCategory({ commit }, name) {
        commit('togglePlaylistCategory', name);
        await persist();
      },
      async setLibraryPlaylistFilter({ commit }, value) {
        commit('setLibraryPlaylistFilter', value);
        await persist();
      },
      async setLanguage({ commit }, value) {
        commit('updateSettings', { key: 'lang', value });
        await persist();
        await applyLanguage(value);
      },
      async setAppearance({ commit, state }, value) {
        commit('updateSettings', { key: 'appearance', value });
        await persist();
        await applyAppearance(state.settings);
      },
      async setThemeColor({ commit, state }, value) {
        commit('updateSettings', { key: 'themeColor', value });
        await persist();
        await applyAppearance(state.settings);
      },
      async setTrayIconTheme({ commit }, value) {
        commit('updateSettings', { key: 'trayIconTheme', value });
        await persist();
        await applyTrayIconTheme(value);
      },
      async setGlobalShortcutsEnabled({ commit, state }, value) {
        commit('updateSettings', { key: 'enableGlobalShortcut', value });
        await persist();
        await applyShortcuts(shortcutControl(state), false);
      },
      async beginShortcutRecording({ commit, state }, { id, type }) {
        if (type === 'globalShortcut' && !state.settings.enableGlobalShortcut)
          return false;
        commit('setShortcutRecording', { id, type });
        await applyShortcuts(shortcutControl(state), false);
        return true;
      },
      async saveShortcut({ commit, state }, { id, type, shortcut }) {
        const value = state.settings.shortcuts.map(item =>
          item.id === id ? { ...item, [type]: shortcut } : cloneDeep(item)
        );
        commit('updateSettings', { key: 'shortcuts', value });
        await persist();
        await applyShortcuts(shortcutControl(state), true);
      },
      async endShortcutRecording({ commit, state }) {
        if (!state.shortcutRecording) return;
        commit('setShortcutRecording', null);
        await applyShortcuts(shortcutControl(state), false);
      },
      async restoreDefaultShortcuts({ commit, state }) {
        commit('updateSettings', {
          key: 'shortcuts',
          value: cloneDeep(shortcuts),
        });
        await persist();
        await applyShortcuts(shortcutControl(state), true);
      },
      async applyRestored({ state }) {
        await persist();
        await applyLanguage(state.settings.lang);
        await applyAppearance(state.settings);
        await applyTrayIconTheme(state.settings.trayIconTheme);
        await applyShortcuts(shortcutControl(state), true);
      },
    },
    mutations: {
      changeMusicQuality(state, value) {
        state.settings.musicQuality = value;
      },
      changeOutputDevice(state, deviceId) {
        state.settings.outputDevice = deviceId;
      },
      updateSettings(state, { key, value }) {
        Vue.set(state.settings, key, value);
      },
      togglePlaylistCategory(state, name) {
        const index = state.settings.enabledPlaylistCategories.findIndex(
          c => c === name
        );
        if (index !== -1) {
          state.settings.enabledPlaylistCategories =
            state.settings.enabledPlaylistCategories.filter(c => c !== name);
        } else {
          state.settings.enabledPlaylistCategories.push(name);
        }
      },
      setShortcutRecording(state, value) {
        state.shortcutRecording = value;
      },
      setLibraryPlaylistFilter(state, value) {
        state.libraryPlaylistFilter = value;
      },
    },
  };
}
