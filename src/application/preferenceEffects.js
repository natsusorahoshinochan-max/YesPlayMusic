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
    applyProxy(config) {
      return ipcRenderer?.invoke('applyProxy', config);
    },
  };
}
