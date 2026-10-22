import { applySettingsAppearance } from '@/utils/appearance';
import { getTrackCache } from '@/utils/db';

export function createPreferenceEffects({
  getLocale,
  getPlayer,
  ipcRenderer = process.env.IS_ELECTRON === true
    ? window.require('electron').ipcRenderer
    : null,
}) {
  return {
    applyLanguage(lang) {
      getLocale().locale = lang;
    },
    applyAppearance: applySettingsAppearance,
    applyOutputDevice() {
      return getPlayer().applyOutputDevice();
    },
    clearCache: () => getTrackCache().clearDB(),
    resetReversedMode() {
      getPlayer().setReversed(false);
    },
    applyTrayIconTheme() {
      ipcRenderer?.send('updateTrayIcon');
    },
    applyShortcuts(control, updateMenu) {
      ipcRenderer?.send('applyShortcuts', control, updateMenu);
    },
    applyProxy(config) {
      return ipcRenderer?.invoke('applyProxy', config);
    },
  };
}
