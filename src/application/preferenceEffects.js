import { applySettingsAppearance } from '@/utils/appearance';
import { clearDB } from '@/utils/db';

export function createPreferenceEffects({
  getLocale,
  getPlayer = () => null,
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
      return getPlayer()?.applyOutputDevice();
    },
    clearCache: clearDB,
    resetReversedMode() {
      const player = getPlayer();
      if (player) player.reversed = false;
    },
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
