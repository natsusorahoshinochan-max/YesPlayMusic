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
      if (
        reason === 'invalidated' &&
        !router.currentRoute.meta?.requireLogin &&
        !router.currentRoute.meta?.requireAccountLogin
      )
        return;

      const name =
        reason === 'account' || reason === 'publicIdentity'
          ? 'library'
          : reason === 'logout'
          ? 'home'
          : router.currentRoute.meta?.requireAccountLogin || isElectron
          ? 'loginAccount'
          : 'login';
      if (router.currentRoute.name !== name) return router.push({ name });
    },
  };
}
