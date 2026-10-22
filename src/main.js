import Vue from 'vue';
import VueGtag from 'vue-gtag';
import App from './App.vue';
import router from './router';
import { createStore } from './store';
import * as auth from '@/api/auth';
import { dailyRecommendTracks } from '@/api/playlist';
import { createLastfmOptions } from '@/application/lastfm';
import nativeAlert from '@/utils/nativeAlert';
import { createCredentials } from '@/application/credentials';
import { createRequestEnvironment } from '@/application/requestEnvironment';
import { createSessionEffects } from '@/application/sessionEffects';
import { libraryApi } from '@/application/library';
import { getTrackCache } from '@/utils/db';
import { configureMusicData } from '@/application/musicData';
import i18n, { initializeLocale } from '@/locale';
import { createPreferenceEffects } from '@/application/preferenceEffects';
import { initializeAppearance } from '@/utils/appearance';
import { configureRequest } from '@/utils/request';
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
(async () => {
  const store = createStore({
    credentials,
    dailyRecommendations: { read: dailyRecommendTracks },
    lastfm: createLastfmOptions(localStorage),
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
  const getSettings = () => store.getters['preferences/settings'];
  const getIdentity = () => ({
    userId: store.getters['library/user'].userId,
    loginMode: store.state.session.loginMode,
    hasAccount: store.getters['session/hasAccount'],
    vipType: store.getters['library/user'].vipType,
  });
  initializeLocale(getSettings().lang);
  configureRequest({
    getSettings,
    getCookie: key => credentials.get(key),
    onSessionInvalid: () => store.dispatch('session/invalidate'),
    environment: createRequestEnvironment(),
  });
  configureMusicData({ getSettings, getIdentity });
  await store.dispatch('session/restore');
  await getTrackCache()
    .initializeTrackCache()
    .catch(error => {
      console.debug('[audio cache] initialization failed', error);
    });
  store.state.player = createPlayer({ store, getSettings, getIdentity });
  // Restoration starts before mounting but does not hold the UI behind remote I/O.
  store.state.player.restoreSaved().catch(error => {
    console.debug('[playback restore]', error);
  });
  await store.dispatch('preferences/applyRestored');
  initializeAppearance(getSettings);
  store.dispatch('session/refreshDaily');
  new Vue({
    i18n,
    store,
    router,
    beforeDestroy() {
      store.dispatch('lastfm/stopConnecting');
      store.state.player.dispose();
    },
    render: h => h(App),
  }).$mount('#app');
})();
