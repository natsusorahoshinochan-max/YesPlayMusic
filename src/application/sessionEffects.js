export function createSessionEffects({
  router,
  notify,
  alert,
  isElectron = Boolean(process.env.IS_ELECTRON),
}) {
  return {
    notify,
    alert,
    navigate(reason) {
      const name =
        reason === 'account' || reason === 'publicIdentity'
          ? 'library'
          : reason === 'logout'
          ? 'home'
          : isElectron
          ? 'loginAccount'
          : 'login';
      if (router.currentRoute.name !== name) return router.push({ name });
    },
  };
}
