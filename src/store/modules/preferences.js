import Vue from 'vue';
import shortcuts from '@/utils/shortcuts';
import cloneDeep from 'lodash/cloneDeep';

export default function createPreferences(snapshot) {
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
    mutations: {
      changeLang(state, lang) {
        state.settings.lang = lang;
      },
      changeMusicQuality(state, value) {
        state.settings.musicQuality = value;
      },
      changeLyricFontSize(state, value) {
        state.settings.lyricFontSize = value;
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
