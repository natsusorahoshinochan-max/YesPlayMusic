export function createSessionEffects({
  router,
  notify,
  isElectron = Boolean(process.env.IS_ELECTRON),
}) {
  return {
    notify,
    navigate(reason) {
      const name =
        reason === 'logout' ? 'home' : isElectron ? 'loginAccount' : 'login';
      if (router.currentRoute.name !== name) return router.push({ name });
    },
  };
}
