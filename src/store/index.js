import Vue from 'vue';
import createDailyRecommendations from './modules/dailyRecommendations';
import { dailyRecommendTracks } from '@/api/playlist';
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
import { auth, authGetSession } from '@/api/lastfm';
import { createLastfmStorage } from '@/application/lastfmStorage';
import { createLastfmExchange } from '@/application/lastfmExchange';
import { getSendSettingsPlugin } from './plugins/sendSettings';

Vue.use(Vuex);
let store;
const noCredentials = { get: () => null, set() {}, remove() {} };
export function createStore({
  storage = localStorage,
  language = navigator.language,
  credentials = noCredentials,
  session = {},
  library = {},
  preferences = {},
  lastfm = {},
  playlistDetail = {},
  actions = {},
} = {}) {
  initializePlayerStorage(storage);
  const persistence = createPersistence(storage, language);
  const lastfmStorage = createLastfmStorage(storage);
  const plugins = [persistence.install];
  if (process.env.IS_ELECTRON === true) plugins.push(getSendSettingsPlugin());
  const identityListeners = new Set();
  const createdStore = new Vuex.Store({
    state: createState(storage),
    mutations,
    actions: { ...rootActions, ...actions },
    plugins,
    modules: {
      dailyRecommendations: createDailyRecommendations({
        read: dailyRecommendTracks,
        getPlayback: () => createdStore.state.player,
      }),
      lastfm: createLastfm({
        storage: lastfmStorage,
        authGetSession,
        auth,
        exchange: createLastfmExchange({ storage: lastfmStorage }),
        ...lastfm,
      }),
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
        ...playlistDetail,
      }),
      preferences: createPreferences(persistence.snapshot.preferences, {
        ...preferences,
        persist: async () => {
          await persistence.ready;
          await persistence.save(createdStore.state);
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
