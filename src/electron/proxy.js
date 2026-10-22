function applyProxyRules(session, proxyRules) {
  return session.setProxy(proxyRules ? { proxyRules } : {});
}

export function restoreProxy(session, store) {
  return applyProxyRules(session, store.get('proxy'));
}

export function registerProxy(ipcMain, session, store) {
  ipcMain.handle('applyProxy', async (event, config) => {
    const proxyRules =
      config.protocol === 'noProxy'
        ? ''
        : `${config.protocol}://${config.server}:${config.port}`;
    if (store.get('proxy') !== proxyRules) store.set('proxy', proxyRules);
    await applyProxyRules(session, proxyRules);
  });
}
