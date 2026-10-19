import Vue from 'vue';
import Vuex from 'vuex';
import state from './state';
import mutations from './mutations';
// vuex 自定义插件
import saveToLocalStorage from './plugins/localStorage';
import { getSendSettingsPlugin } from './plugins/sendSettings';

Vue.use(Vuex);

let store;

export function createStore({ actions = {} } = {}) {
  const plugins = [saveToLocalStorage];
  if (process.env.IS_ELECTRON === true) {
    plugins.push(getSendSettingsPlugin());
  }
  store = new Vuex.Store({ state, mutations, actions, plugins });
  if ([undefined, null].includes(store.state.settings.lang)) {
    const langMapper = new Map()
      .set('zh', 'zh-CN')
      .set('zh-TW', 'zh-TW')
      .set('en', 'en')
      .set('tr', 'tr');
    store.state.settings.lang =
      langMapper.get(
        langMapper.has(navigator.language)
          ? navigator.language
          : navigator.language.slice(0, 2)
      ) || 'en';
    localStorage.setItem('settings', JSON.stringify(store.state.settings));
  }
  return store;
}

export { store as default };
