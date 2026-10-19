import axios from 'axios';

let getSettings;
let readCookie;
let sessionInvalid;

export function configureRequest({
  getSettings: settings,
  getCookie,
  onSessionInvalid,
}) {
  getSettings = settings;
  readCookie = getCookie;
  sessionInvalid = onSessionInvalid;
}

let baseURL = '';
// Web 和 Electron 跑在不同端口避免同时启动时冲突
if (process.env.IS_ELECTRON) {
  if (process.env.NODE_ENV === 'production') {
    baseURL = process.env.VUE_APP_ELECTRON_API_URL || '';
  } else {
    baseURL = process.env.VUE_APP_ELECTRON_API_URL_DEV || '';
  }
} else {
  baseURL = process.env.VUE_APP_NETEASE_API_URL || '';
}

const service = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 15000,
});

service.interceptors.request.use(function (config) {
  const baseURL = config.baseURL || '';
  if (!config.params) config.params = {};
  if (baseURL.length) {
    if (
      baseURL[0] !== '/' &&
      !process.env.IS_ELECTRON &&
      readCookie('MUSIC_U') !== null
    ) {
      config.params.cookie = `MUSIC_U=${readCookie('MUSIC_U')};`;
    }
  } else {
    console.error("You must set up the baseURL in the service's config");
  }

  if (!process.env.IS_ELECTRON && !config.url.includes('/login')) {
    config.params.realIP = '211.161.244.70';
  }

  // Force real_ip
  const { enableRealIP, realIP, proxyConfig: proxy } = getSettings();
  if (process.env.VUE_APP_REAL_IP) {
    config.params.realIP = process.env.VUE_APP_REAL_IP;
  } else if (enableRealIP) {
    config.params.realIP = realIP;
  }

  if (['HTTP', 'HTTPS'].includes(proxy.protocol)) {
    config.params.proxy = `${proxy.protocol}://${proxy.server}:${proxy.port}`;
  }

  return config;
});

service.interceptors.response.use(
  response => {
    const res = response.data;
    return res;
  },
  async error => {
    /** @type {import('axios').AxiosResponse | null} */
    let response;
    let data;
    if (error === 'TypeError: baseURL is undefined') {
      response = error;
      data = error;
      console.error("You must set up the baseURL in the service's config");
    } else if (error.response) {
      response = error.response;
      data = response.data;
    }

    if (
      response &&
      typeof data === 'object' &&
      data.code === 301 &&
      data.msg === '需要登录'
    ) {
      await sessionInvalid();
    }
  }
);

export default service;
