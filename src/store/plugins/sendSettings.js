export function getSendSettingsPlugin() {
  const electron = window.require('electron');
  const ipcRenderer = electron.ipcRenderer;
  return store => {
    ipcRenderer.send('settings', store.getters['preferences/settings']);
    store.subscribe((mutation, state) => {
      if (!mutation.type.startsWith('preferences/')) return;
      ipcRenderer.send('settings', state.preferences.settings);
    });
  };
}
