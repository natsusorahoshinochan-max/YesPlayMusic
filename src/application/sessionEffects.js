export function createSessionEffects({
  router,
  notify,
  alert,
  isElectron = Boolean(process.env.IS_ELECTRON),
}) {
  return {
    notify,
    alert,
    async navigate(reason, { isCurrent = () => true } = {}) {
      if (!isCurrent()) return false;
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
      if (router.currentRoute.name === name) return;
      if (reason !== 'invalidated') return router.push({ name });
      let ownedRoute;
      const removeCapture = router.beforeEach((to, from, next) => {
        if (!ownedRoute && to.name === name) ownedRoute = to;
        next();
      });
      const removeCheck = router.beforeResolve((to, from, next) => {
        next(to === ownedRoute && !isCurrent() ? false : undefined);
      });
      try {
        return await router.push({ name });
      } finally {
        removeCapture();
        removeCheck();
      }
    },
  };
}
