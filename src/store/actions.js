import Vue from 'vue';
import locale from '@/locale';

export default {
  async copyText({ dispatch }, text) {
    try {
      await Vue.prototype.$copyText(text);
      dispatch('showToast', locale.t('toast.copied'));
    } catch (error) {
      dispatch('showToast', `${locale.t('toast.copyFailed')}${error}`);
    }
  },
  showToast({ state, commit }, text) {
    if (state.toast.timer !== null) {
      clearTimeout(state.toast.timer);
      commit('updateToast', { show: false, text: '', timer: null });
    }
    commit('updateToast', {
      show: true,
      text,
      timer: setTimeout(() => {
        commit('updateToast', {
          show: false,
          text: state.toast.text,
          timer: null,
        });
      }, 3200),
    });
  },
};
