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
  const getIdentity = () => ({
    userId: store.getters['library/user']?.userId,
    loginMode: store.state.session?.loginMode,
    hasAccount: store.getters['session/hasAccount'],
    vipType: store.getters['library/user'].vipType,
  });
  const i18n = initializeLocale(getSettings().lang);
  configureRequest({
    getSettings,
    getCookie,
    getSessionOwnership: () => store.getters['session/ownership'],
    onSessionInvalid,
    environment: requestEnvironment,
  });
  await initializeDependencies(store, { getSettings, getIdentity });
  store.state.player = createPlayer({ store, getSettings, getIdentity });
  // Restoration starts before mounting but does not hold the UI behind remote I/O.
  store.state.player.restoreSaved?.().catch(error => {
    console.debug('[playback restore]', error);
  });
  await store.dispatch('preferences/applyRestored');
  initializeAppearance(getSettings);
  return mount({ store, i18n });
}
