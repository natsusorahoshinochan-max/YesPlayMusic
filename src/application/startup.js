export async function startApplication({
  createStore,
  initializeLocale,
  initializeAppearance,
  configureRequest,
  requestEnvironment,
  getCookie,
  onSessionInvalid,
  createPlayer,
  mount,
}) {
  const store = createStore();
  const getSettings = () => store.getters['preferences/settings'];
  const i18n = initializeLocale(getSettings().lang);
  configureRequest({
    getSettings,
    getCookie,
    onSessionInvalid,
    environment: requestEnvironment,
  });
  store.state.player = createPlayer({ store });
  await store.dispatch('preferences/applyRestored');
  initializeAppearance(getSettings);
  return mount({ store, i18n });
}
