import Vue from 'vue';
import createDailyRecommendations from './modules/dailyRecommendations';
import Vuex from 'vuex';
import { initializePlayerStorage } from '@/application/playerStorage';
import createState from './state';
import mutations from './mutations';
import rootActions from './actions';
import { createPersistence } from './persistence';
import createSession from './modules/session';
import createLibrary from './modules/library';
import createPlaylistDetail from './modules/playlistDetail';
import createPreferences from './modules/preferences';
import createLastfm from './modules/lastfm';
import { createSettingsSender } from './sendSettings';

Vue.use(Vuex);
let store;
export function createStore({
  storage = localStorage,
  language = navigator.language,
  credentials,
  session,
  library,
  preferences,
  lastfm,
  dailyRecommendations,
}) {
  initializePlayerStorage(storage);
  const persistence = createPersistence(storage, language);
  const sendSettings =
    process.env.IS_ELECTRON === true ? createSettingsSender() : () => {};
  const identityListeners = new Set();
  const createdStore = new Vuex.Store({
    state: createState(storage),
    mutations,
    actions: rootActions,
    plugins: [persistence.install],
    modules: {
      dailyRecommendations: createDailyRecommendations({
        ...dailyRecommendations,
        getPlayback: () => createdStore.state.player,
      }),
      lastfm: createLastfm(lastfm),
      session: createSession(persistence.snapshot.session, {
        ...session,
        credentials,
        identityChanged() {
          createdStore.dispatch('dailyRecommendations/identityChanged');
          createdStore.state.player?.lyrics?.identityChanged();
          identityListeners.forEach(changed => changed());
        },
      }),
      library: createLibrary(persistence.snapshot.library, library),
      playlistDetail: createPlaylistDetail({
        api: library.api,
      }),
      preferences: createPreferences(persistence.snapshot.preferences, {
        ...preferences,
        persist: async () => {
          await persistence.ready;
          const settings = await persistence.save(createdStore.state);
          sendSettings(settings);
        },
      }),
    },
  });
  createdStore.subscribeIdentityChanges = changed => {
    identityListeners.add(changed);
    return () => identityListeners.delete(changed);
  };
  createdStore.dispatch('lastfm/restore');
  store = createdStore;
  return createdStore;
}
export { store as default };
