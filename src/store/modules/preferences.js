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
    applyProxy = () => {},
    applyAppearance = () => {},
  } = {}
) {
  return {
    namespaced: true,
    state: () => ({
      settings: snapshot.settings,
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
      async submitProxy({ commit, state }, config) {
        const value = mergeWith(
          {},
          state.settings.proxyConfig,
          config,
          (previous, next) =>
            Array.isArray(next) ? cloneDeep(next) : undefined
        );
        value.port = Number(value.port) || null;
        if (!value.server || !value.port || value.protocol === 'noProxy')
          value.protocol = 'noProxy';
        commit('updateSettings', { key: 'proxyConfig', value });
        await persist();
        await applyProxy(cloneDeep(value));
      },
      async disableProxy({ dispatch }) {
        await dispatch('submitProxy', { protocol: 'noProxy' });
      },
      async applyRestored({ state }) {
        await persist();
        await applyLanguage(state.settings.lang);
        await applyAppearance(state.settings);
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
      updateShortcut(state, { id, type, shortcut }) {
        let newShortcut = state.settings.shortcuts.find(s => s.id === id);
        newShortcut[type] = shortcut;
        state.settings.shortcuts = state.settings.shortcuts.map(s => {
          if (s.id !== id) return s;
          return newShortcut;
        });
      },
      restoreDefaultShortcuts(state) {
        state.settings.shortcuts = cloneDeep(shortcuts);
      },
      setLibraryPlaylistFilter(state, value) {
        state.libraryPlaylistFilter = value;
      },
    },
  };
}
