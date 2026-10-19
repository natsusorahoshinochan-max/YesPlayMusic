import { applySettingsAppearance } from '@/utils/appearance';

export function createPreferenceEffects({ getLocale }) {
  return {
    applyLanguage(lang) {
      getLocale().locale = lang;
    },
    applyAppearance: applySettingsAppearance,
  };
}
