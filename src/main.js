import Vue from 'vue';
import VueGtag from 'vue-gtag';
import App from './App.vue';
import router from './router';
import { createStore } from './store';
import actions from './store/actions';
import { initializeTrackCache } from '@/utils/db';
import { initializeLocale } from '@/locale';
import { initializeAppearance } from '@/utils/appearance';
import { configureRequest } from '@/utils/request';
import { getCookie, doLogout } from '@/utils/auth';
import { startApplication } from '@/application/startup';
import { createPlayer } from '@/application/player';
import '@/assets/icons';
import '@/utils/filters';
import './registerServiceWorker';
import { dailyTask } from '@/utils/common';
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

NProgress.configure({ showSpinner: false, trickleSpeed: 100 });
startApplication({
  createStore() {
    const store = createStore({ actions });
    initializeTrackCache();
    return store;
  },
  initializeLocale,
  initializeAppearance,
  configureRequest,
  getCookie,
  onSessionInvalid() {
    doLogout();
    return router.push({
      name: process.env.IS_ELECTRON ? 'loginAccount' : 'login',
    });
  },
  createPlayer,
  mount({ store, i18n }) {
    dailyTask();
    return new Vue({
      i18n,
      store,
      router,
      render: h => h(App),
    }).$mount('#app');
  },
});
