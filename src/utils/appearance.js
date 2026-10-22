const themeColorPresets = {
  default: {
    light: {
      primary: '#335eea',
      primaryBg: '#eaeffd',
      primaryBgForTransparent: 'rgba(189, 207, 255, 0.28)',
      primaryGradient: '#335eea',
    },
    dark: {
      primary: '#335eea',
      primaryBg: '#bbcdff',
      primaryBgForTransparent: 'rgba(255, 255, 255, 0.12)',
      primaryGradient: '#335eea',
    },
  },
  sunset: {
    light: {
      primary: '#dd2476',
      primaryBg: '#ffe1ed',
      primaryBgForTransparent: 'rgba(221, 36, 118, 0.2)',
      primaryGradient: 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)',
    },
    dark: {
      primary: '#ff6fa5',
      primaryBg: '#3d182b',
      primaryBgForTransparent: 'rgba(255, 111, 165, 0.24)',
      primaryGradient: 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)',
    },
  },
  ocean: {
    light: {
      primary: '#0072ff',
      primaryBg: '#e0f2ff',
      primaryBgForTransparent: 'rgba(0, 114, 255, 0.18)',
      primaryGradient: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
    },
    dark: {
      primary: '#5aa2ff',
      primaryBg: '#15233a',
      primaryBgForTransparent: 'rgba(90, 162, 255, 0.24)',
      primaryGradient: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
    },
  },
  forest: {
    light: {
      primary: '#56ab2f',
      primaryBg: '#e6f7da',
      primaryBgForTransparent: 'rgba(86, 171, 47, 0.18)',
      primaryGradient: 'linear-gradient(135deg, #56ab2f 0%, #a8e063 100%)',
    },
    dark: {
      primary: '#7cd957',
      primaryBg: '#1b3020',
      primaryBgForTransparent: 'rgba(124, 217, 87, 0.24)',
      primaryGradient: 'linear-gradient(135deg, #56ab2f 0%, #a8e063 100%)',
    },
  },
};

export function applySettingsAppearance(settings) {
  const useSystemAppearance =
    settings.appearance === 'auto' || settings.appearance === undefined;
  const dark = useSystemAppearance
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : settings.appearance === 'dark';
  const appearance = dark ? 'dark' : 'light';
  const preset =
    themeColorPresets[settings.themeColor] || themeColorPresets.default;
  const theme = preset[appearance];
  const target = document.body;
  target.setAttribute('data-theme', appearance);
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute('content', dark ? '#222' : '#fff');
  target.style.setProperty('--color-primary', theme.primary);
  target.style.setProperty('--color-primary-bg', theme.primaryBg);
  target.style.setProperty(
    '--color-primary-bg-for-transparent',
    theme.primaryBgForTransparent
  );
  target.style.setProperty('--color-primary-gradient', theme.primaryGradient);
}

export function initializeAppearance(getSettings) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (getSettings().appearance === 'auto')
      applySettingsAppearance(getSettings());
  });
}
