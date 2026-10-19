import Vue from 'vue';
import VueClipboard from 'vue-clipboard2';
import VueI18n from 'vue-i18n';

import en from './lang/en.js';
import zhCN from './lang/zh-CN.js';
import zhTW from './lang/zh-TW.js';
import tr from './lang/tr.js';

Vue.use(VueClipboard);
Vue.use(VueI18n);

let i18n;

export function initializeLocale(lang) {
  i18n = new VueI18n({
    locale: lang,
    messages: {
      en,
      'zh-CN': zhCN,
      'zh-TW': zhTW,
      tr,
    },
    silentTranslationWarn: true,
  });
  return i18n;
}

export { i18n as default };
