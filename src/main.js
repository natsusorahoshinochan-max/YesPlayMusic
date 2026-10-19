import Vue from 'vue';
import VueGtag from 'vue-gtag';
import App from './App.vue';
import router from './router';
import store, { createStore } from './store';
import * as auth from '@/api/auth';
import nativeAlert from '@/utils/nativeAlert';
import { createCredentials } from '@/application/credentials';
import { createRequestEnvironment } from '@/application/requestEnvironment';
import { createSessionEffects } from '@/application/sessionEffects';
import { libraryApi } from '@/application/library';
import { initializeTrackCache } from '@/utils/db';
import i18n, { initializeLocale } from '@/locale';
import { createPreferenceEffects } from '@/application/preferenceEffects';
import { initializeAppearance } from '@/utils/appearance';
import { configureRequest } from '@/utils/request';
import { startApplication } from '@/application/startup';
import { createPlayer } from '@/application/player';
import '@/assets/icons';
import '@/utils/filters';
import './registerServiceWorker';
import '@/assets/css/global.scss';
import NProgress from 'nprogress';
import '@/assets/css/nprogress.css';

window.resetApp = () => {
  localStorage.clear();
  indexedDB.deleteDatabase('yesplaymusic');
  document.cookie.split(';').forEach(function (c) {
    document.cookie = c
      .replace(/^ +/, '')
      .replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
  });
  return '已重置应用，请刷新页面（按Ctrl/Command + R）';
};
console.log(
  '如出现问题，可尝试在本页输入 %cresetApp()%c 然后按回车重置应用。',
  'background: #eaeffd;color:#335eea;padding: 4px 6px;border-radius:3px;',
  'background:unset;color:unset;'
);

Vue.use(
  VueGtag,
  {
    config: { id: 'G-KMJJCFZDKF' },
  },
  router
);
Vue.config.productionTip = false;

const credentials = createCredentials();
NProgress.configure({ showSpinner: false, trickleSpeed: 100 });
startApplication({
  createStore() {
    const store = createStore({
      credentials,
      session: {
        auth,
        ...createSessionEffects({
          router,
          alert: nativeAlert,
          notify: message => store.dispatch('showToast', message),
        }),
      },
      preferences: createPreferenceEffects({
        getLocale: () => i18n,
        getPlayer: () => store.state.player,
      }),
      library: { api: libraryApi },
    });
    return store;
  },
  async initializeDependencies(store) {
    await store.dispatch('session/restore');
    await initializeTrackCache().catch(error => {
      console.debug('[audio cache] initialization failed', error);
    });
  },
  initializeLocale,
  initializeAppearance,
  configureRequest,
  requestEnvironment: createRequestEnvironment(),
  getCookie: key => credentials.get(key),
  onSessionInvalid: () => store.dispatch('session/invalidate'),
  createPlayer,
  mount({ store, i18n }) {
    store.dispatch('session/refreshDaily');
    return new Vue({
      i18n,
      store,
      router,
      render: h => h(App),
      beforeDestroy() {
        store.state.player.dispose();
      },
    }).$mount('#app');
  },
});
