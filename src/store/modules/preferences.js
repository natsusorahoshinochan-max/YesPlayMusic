import Vue from 'vue';
import shortcuts from '@/utils/shortcuts';
import cloneDeep from 'lodash/cloneDeep';
import mergeWith from 'lodash/mergeWith';
import isPlainObject from 'lodash/isPlainObject';

export default function createPreferences(
  snapshot,
  {
    persist,
    applyLanguage,
    applyProxy,
    applyAppearance,
    clearCache,
    applyOutputDevice,
    resetReversedMode,
    applyShortcuts,
    applyTrayIconTheme,
  }
) {
  const shortcutControl = state => ({
    enabled: state.settings.enableGlobalShortcut !== false,
    recording: state.shortcutRecording,
  });
  return {
    namespaced: true,
    state: () => ({
      settings: snapshot.settings,
      shortcutRecording: false,
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
      async setMusicQuality({ commit, state }, value) {
        value = value === 'flac' ? value : Number(value);
        const previous = state.settings.musicQuality;
        const changed =
          value !== (previous === 'flac' ? previous : Number(previous));
        commit('updateSettings', { key: 'musicQuality', value });
        await persist();
        if (changed) await clearCache();
      },
      async setOutputDevice({ commit }, value) {
        if (value === undefined) return;
        commit('updateSettings', { key: 'outputDevice', value });
        await persist();
        await applyOutputDevice();
      },
      async setAutomaticCaching({ commit }, value) {
        value = Boolean(value);
        commit('updateSettings', { key: 'automaticallyCacheSongs', value });
        await persist();
        if (!value) await clearCache();
      },
      async setReversedModeEnabled({ commit }, value) {
        value = Boolean(value);
        commit('updateSettings', { key: 'enableReversedMode', value });
        await persist();
        if (!value) await resetReversedMode();
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
        await applyTrayIconTheme();
      },
      async setGlobalShortcutsEnabled({ commit, state }, value) {
        commit('updateSettings', { key: 'enableGlobalShortcut', value });
        await persist();
        await applyShortcuts(shortcutControl(state), false);
      },
      async beginShortcutRecording({ commit, state }, type) {
        if (type === 'globalShortcut' && !state.settings.enableGlobalShortcut)
          return false;
        commit('setShortcutRecording', true);
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
        commit('setShortcutRecording', false);
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
        await applyOutputDevice();
        await applyLanguage(state.settings.lang);
        await applyAppearance(state.settings);
        await applyTrayIconTheme();
        await applyShortcuts(shortcutControl(state), true);
      },
    },
    mutations: {
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
