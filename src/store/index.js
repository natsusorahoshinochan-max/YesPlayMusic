import Vue from 'vue';
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
  playlistDetail = {},
  actions = {},
} = {}) {
  initializePlayerStorage(storage);
  const persistence = createPersistence(storage, language);
  const plugins = [persistence.install];
  if (process.env.IS_ELECTRON === true) plugins.push(getSendSettingsPlugin());
  store = new Vuex.Store({
    state: createState(storage),
    mutations,
    actions: { ...rootActions, ...actions },
    plugins,
    modules: {
      session: createSession(persistence.snapshot.session, {
        ...session,
        credentials,
      }),
      library: createLibrary(persistence.snapshot.library, library),
      playlistDetail: createPlaylistDetail({
        api: library.api,
        ...playlistDetail,
      }),
      preferences: createPreferences(persistence.snapshot.preferences),
    },
  });
  return store;
}
export { store as default };
