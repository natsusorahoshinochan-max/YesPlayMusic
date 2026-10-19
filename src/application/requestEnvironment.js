export function createRequestEnvironment({
  isElectron = Boolean(process.env.IS_ELECTRON),
  mode = process.env.NODE_ENV,
  webBaseURL = process.env.VUE_APP_NETEASE_API_URL || '',
  electronBaseURL = process.env.VUE_APP_ELECTRON_API_URL || '',
  electronDevelopmentBaseURL = process.env.VUE_APP_ELECTRON_API_URL_DEV || '',
  forcedRealIP = process.env.VUE_APP_REAL_IP,
} = {}) {
  return {
    baseURL: isElectron
      ? mode === 'production'
        ? electronBaseURL
        : electronDevelopmentBaseURL
      : webBaseURL,
    configure(config, { getCookie, settings }) {
      if (!config.params) config.params = {};
      const baseURL = config.baseURL || '';
      if (baseURL && baseURL[0] !== '/' && !isElectron) {
        const token = getCookie('MUSIC_U');
        if (token) config.params.cookie = `MUSIC_U=${token};`;
      }
      if (!isElectron && !config.url.includes('/login')) {
        config.params.realIP = '211.161.244.70';
      }
      if (forcedRealIP) {
        config.params.realIP = forcedRealIP;
      } else if (settings.enableRealIP) {
        config.params.realIP = settings.realIP;
      }
      const proxy = settings.proxyConfig;
      if (proxy && ['HTTP', 'HTTPS'].includes(proxy.protocol)) {
        config.params.proxy = `${proxy.protocol}://${proxy.server}:${proxy.port}`;
      }
      return config;
    },
  };
}
