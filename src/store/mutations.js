export default {
  updateToast(state, toast) {
    state.toast = toast;
  },
  updateModal(state, { modalName, key, value }) {
    state.modals[modalName][key] = value;
  },
  toggleLyrics(state) {
    state.showLyrics = !state.showLyrics;
  },
  updateTitle(state, title) {
    state.title = title;
  },
};
