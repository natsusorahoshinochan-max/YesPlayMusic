import { applySettingsAppearance } from '@/utils/appearance';

export function createPreferenceEffects({ getLocale }) {
  const send = (...args) => {
    if (process.env.IS_ELECTRON === true)
      window.require('electron').ipcRenderer.send(...args);
  };
  return {
    applyLanguage(lang) {
      getLocale().locale = lang;
    },
    applyAppearance: applySettingsAppearance,
    applyTrayIconTheme(value) {
      send('updateTrayIcon', value);
    },
    applyShortcuts(control, updateMenu) {
      send('applyShortcuts', control, updateMenu);
    },
  };
}
