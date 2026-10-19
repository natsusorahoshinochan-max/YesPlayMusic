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
      return getPlayer()?.setOutputDevice();
    },
    clearCache: clearDB,
    resetReversedMode() {
      const player = getPlayer();
      if (player) player.reversed = false;
    },
    applyProxy(config) {
      return ipcRenderer?.invoke('applyProxy', config);
    },
  };
}
