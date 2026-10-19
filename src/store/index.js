import Vue from 'vue';
import Vuex from 'vuex';
import { initializePlayerStorage } from '@/application/playerStorage';
import createState from './state';
import mutations from './mutations';
import rootActions from './actions';
import { createPersistence } from './persistence';
import createSession from './modules/session';
import createLibrary from './modules/library';
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
  preferences = {},
  actions = {},
} = {}) {
  initializePlayerStorage(storage);
  const persistence = createPersistence(storage, language);
  const plugins = [persistence.install];
  if (process.env.IS_ELECTRON === true) plugins.push(getSendSettingsPlugin());
  const createdStore = new Vuex.Store({
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
      preferences: createPreferences(persistence.snapshot.preferences, {
        ...preferences,
        persist: async () => {
          await persistence.ready;
          await persistence.save(createdStore.state);
        },
      }),
    },
  });
  store = createdStore;
  return createdStore;
}
export { store as default };
