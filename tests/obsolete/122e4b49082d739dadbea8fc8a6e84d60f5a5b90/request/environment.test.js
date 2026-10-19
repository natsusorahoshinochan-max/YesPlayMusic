/* eslint-env jest */
import request, { configureRequest } from '@/utils/request';
import { createRequestEnvironment } from '@/application/requestEnvironment';

function configure(environment, options = {}) {
  const { settings = {} } = options;
  const token = 'token' in options ? options.token : 'account-token';
  configureRequest({
    environment,
    getSettings: () => ({ proxyConfig: {}, ...settings }),
    getCookie: () => token,
    onSessionInvalid: () => {
      throw new Error('Unexpected session invalidation');
    },
  });
  request.defaults.adapter = config =>
    Promise.resolve({ data: config, config, status: 200 });
}

test('Web requests use their API address, cross-origin credentials and configured network preferences', async () => {
  configure(
    createRequestEnvironment({
      isElectron: false,
      webBaseURL: 'https://music.example/api',
    }),
    {
      settings: {
        enableRealIP: true,
        realIP: '203.0.113.5',
        proxyConfig: { protocol: 'HTTPS', server: 'proxy.example', port: 8443 },
      },
    }
  );
  const response = await request({ url: '/song/detail', params: { id: 123 } });
  expect(response.baseURL).toBe('https://music.example/api');
  expect(response.withCredentials).toBe(true);
  expect(response.timeout).toBe(15000);
  expect(response.params).toEqual({
    id: 123,
    cookie: 'MUSIC_U=account-token;',
    realIP: '203.0.113.5',
    proxy: 'HTTPS://proxy.example:8443',
  });
});

test.each([
  ['production', 'http://desktop.example/api'],
  ['development', 'http://localhost:10754'],
])(
  'Electron %s requests retain browser credential transport and use the desktop API',
  async (mode, expectedBaseURL) => {
    configure(
      createRequestEnvironment({
        isElectron: true,
        mode,
        webBaseURL: 'https://web.example/api',
        electronBaseURL: 'http://desktop.example/api',
        electronDevelopmentBaseURL: 'http://localhost:10754',
      })
    );
    const config = await request({ url: '/song/detail' });
    expect(config.baseURL).toBe(expectedBaseURL);
    expect(config.withCredentials).toBe(true);
    expect(config.params).toEqual({});
  }
);

test.each([null, undefined, ''])(
  'Web requests do not serialize an absent credential (%s)',
  async token => {
    configure(
      createRequestEnvironment({
        isElectron: false,
        webBaseURL: 'https://music.example/api',
      }),
      { token }
    );
    const config = await request({ url: '/song/detail' });
    expect(config.params).toEqual({ realIP: '211.161.244.70' });
  }
);

test('relative Web API and login requests retain same-origin credential transport without the default real IP', async () => {
  configure(
    createRequestEnvironment({ isElectron: false, webBaseURL: '/api' })
  );
  const config = await request({ url: '/login/cellphone' });
  expect(config.withCredentials).toBe(true);
  expect(config.params).toEqual({});
});

test.each([false, true])(
  'environment real IP overrides preferences and unsupported proxy transports are omitted (Electron: %s)',
  async isElectron => {
    configure(
      createRequestEnvironment({
        isElectron,
        webBaseURL: '/api',
        electronDevelopmentBaseURL: '/api',
        forcedRealIP: '198.51.100.9',
      }),
      {
        settings: {
          enableRealIP: true,
          realIP: '203.0.113.5',
          proxyConfig: {
            protocol: 'SOCKS',
            server: 'proxy.example',
            port: 1234,
          },
        },
      }
    );
    expect((await request({ url: '/login/qr/check' })).params).toEqual({
      realIP: '198.51.100.9',
    });
  }
);

test('request wiring requires an explicit session invalidation effect', () => {
  expect(() =>
    configureRequest({
      getSettings: () => ({}),
      getCookie: () => null,
    })
  ).toThrow('Request configuration requires onSessionInvalid');
});
