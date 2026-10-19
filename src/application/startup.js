export function startApplication({
  createStore,
  initializeLocale,
  initializeAppearance,
  configureRequest,
  getCookie,
  onSessionInvalid,
  createPlayer,
  mount,
}) {
  const store = createStore();
  const getSettings = () => store.state.settings;
  const i18n = initializeLocale(getSettings().lang);
  initializeAppearance(getSettings);
  configureRequest({ getSettings, getCookie, onSessionInvalid });
  store.state.player = createPlayer();
  return mount({ store, i18n });
}
