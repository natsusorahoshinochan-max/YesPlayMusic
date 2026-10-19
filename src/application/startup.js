export function startApplication({
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
  initializeAppearance(getSettings);
  configureRequest({
    getSettings,
    getCookie,
    onSessionInvalid,
    environment: requestEnvironment,
  });
  store.state.player = createPlayer();
  return mount({ store, i18n });
}
