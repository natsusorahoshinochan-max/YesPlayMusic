export async function startApplication({
  createStore,
  initializeLocale,
  initializeAppearance,
  configureRequest,
  requestEnvironment,
  getCookie,
  onSessionInvalid,
  createPlayer,
  initializeDependencies = () => {},
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
  await initializeDependencies(store);
  store.state.player = createPlayer({ store });
  // Restoration starts before mounting but does not hold the UI behind remote I/O.
  store.state.player.restoreSaved?.().catch(error => {
    console.debug('[playback restore]', error);
  });
  await store.dispatch('preferences/applyRestored');
  initializeAppearance(getSettings);
  return mount({ store, i18n });
}
