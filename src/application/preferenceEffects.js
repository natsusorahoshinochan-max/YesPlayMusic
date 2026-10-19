import { applySettingsAppearance } from '@/utils/appearance';

export function createPreferenceEffects({
  getLocale,
  ipcRenderer = process.env.IS_ELECTRON === true
    ? window.require('electron').ipcRenderer
    : null,
}) {
  return {
    applyLanguage(lang) {
      getLocale().locale = lang;
    },
    applyAppearance: applySettingsAppearance,
    applyTrayIconTheme(value) {
      ipcRenderer?.send('updateTrayIcon', value);
    },
    applyShortcuts(control, updateMenu) {
      ipcRenderer?.send('applyShortcuts', control, updateMenu);
    },
    applyProxy(config) {
      return ipcRenderer?.invoke('applyProxy', config);
    },
  };
}
