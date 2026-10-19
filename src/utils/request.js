import axios from 'axios';
import { createRequestEnvironment } from '@/application/requestEnvironment';

let dependencies;

export function configureRequest({
  getSettings,
  getCookie,
  onSessionInvalid,
  getSessionOwnership = () => null,
  environment = createRequestEnvironment(),
}) {
  if (typeof onSessionInvalid !== 'function') {
    throw new TypeError('Request configuration requires onSessionInvalid');
  }
  dependencies = {
    getSettings,
    getCookie,
    onSessionInvalid,
    getSessionOwnership,
    environment,
  };
  service.defaults.baseURL = environment.baseURL;
}

const service = axios.create({ withCredentials: true, timeout: 15000 });

service.interceptors.request.use(
  config => {
    if (!dependencies)
      throw new Error('Request module has not been configured');
    const { environment, getCookie, getSettings, getSessionOwnership } =
      dependencies;
    config.sessionOwnership = getSessionOwnership();
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

export class RequestFailure extends Error {
  constructor(category, { response, config, cause }) {
    const data = response?.data;
    const body = data?.body?.code !== undefined ? data.body : data;
    super(body?.msg || body?.message || cause?.message || 'Request rejected');
    this.name = 'RequestFailure';
    this.category = category;
    this.data = data;
    this.status = response?.status;
    this.code = body?.code ?? cause?.code;
    this.url = config?.url;
    this.ownership = config?.sessionOwnership;
    this.cause = cause;
  }
}

async function interpret(response, cause) {
  const config = response?.config || cause?.config;
  // Configuration, preparation and programming errors retain their original type.
  if (!response && !cause?.request) throw cause;
  const data = response?.data;
  const body = data?.body?.code !== undefined ? data.body : data;
  const code = body?.code;
  const protocolSuccess =
    code === undefined || code === 200 || config?.acceptedCodes?.includes(code);
  if (!cause && protocolSuccess) return data;
  const category =
    code === 301 &&
    body?.msg === '需要登录' &&
    config?.sessionInvalidation !== false
      ? 'session-invalid'
      : code !== undefined || (response && response.status < 500)
      ? 'business'
      : 'network';
  const failure = new RequestFailure(category, { response, config, cause });
  if (
    category === 'session-invalid' &&
    (!config?.isCurrent || config.isCurrent())
  ) {
    await dependencies.onSessionInvalid(failure);
  }
  throw failure;
}

service.interceptors.response.use(
  response => interpret(response),
  error => interpret(error?.response, error)
);

// Axios synchronous interceptors can throw before returning their Promise.
export default function request(config) {
  try {
    return service(config);
  } catch (error) {
    return Promise.reject(error);
  }
}
request.defaults = service.defaults;
