import axios from 'axios';
import { createRequestEnvironment } from '@/application/requestEnvironment';

let dependencies;

export function configureRequest({
  getSettings,
  getCookie,
  onSessionInvalid,
  environment = createRequestEnvironment(),
}) {
  if (typeof onSessionInvalid !== 'function') {
    throw new TypeError('Request configuration requires onSessionInvalid');
  }
  dependencies = { getSettings, getCookie, onSessionInvalid, environment };
  service.defaults.baseURL = environment.baseURL;
}

const service = axios.create({ withCredentials: true, timeout: 15000 });

service.interceptors.request.use(
  config => {
    if (!dependencies)
      throw new Error('Request module has not been configured');
    const { environment, getCookie, getSettings } = dependencies;
    return environment.configure(config, {
      getCookie,
      settings: getSettings(),
    });
  },
  error => {
    throw error;
  },
  // Capture transport credentials before a session operation removes them.
  { synchronous: true }
);

service.interceptors.response.use(
  response => response.data,
  async error => {
    const response = error?.response;
    const data = response?.data;
    const url = error?.config?.url || response?.config?.url || '';
    if (
      (!error?.config?.isCurrent || error.config.isCurrent()) &&
      data &&
      data.code === 301 &&
      data.msg === '需要登录' &&
      !url.split('?')[0].endsWith('/logout')
    ) {
      await dependencies.onSessionInvalid().catch(sessionError => {
        console.debug('[request] session invalidation failed', sessionError);
      });
    }
    throw error;
  }
);

export default service;
