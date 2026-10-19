import { restoreProxy, registerProxy } from '@/electron/proxy';

test('桌面启动恢复主进程已有代理，运行时与关闭共用平台应用并保存规则', async () => {
  const values = {
    proxy: 'HTTPS://main-process:443',
    settings: {
      proxyConfig: { protocol: 'HTTP', server: 'renderer', port: 80 },
    },
  };
  const store = {
    get: key => values[key],
    set: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const session = { setProxy: jest.fn().mockResolvedValue() };
  const handlers = {};
  registerProxy(
    {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    },
    session,
    store
  );
  await restoreProxy(session, store);
  expect(session.setProxy).toHaveBeenLastCalledWith({
    proxyRules: 'HTTPS://main-process:443',
  });
  await handlers.applyProxy(
    {},
    { protocol: 'HTTP', server: 'submitted', port: 8080 }
  );
  expect(values.proxy).toBe('HTTP://submitted:8080');
  store.set.mockClear();
  await handlers.applyProxy(
    {},
    { protocol: 'HTTP', server: 'submitted', port: 8080 }
  );
  expect(store.set).not.toHaveBeenCalled();
  expect(session.setProxy).toHaveBeenLastCalledWith({
    proxyRules: 'HTTP://submitted:8080',
  });
  await handlers.applyProxy({}, { protocol: 'noProxy' });
  expect(values.proxy).toBe('');
  expect(session.setProxy).toHaveBeenLastCalledWith({});
  session.setProxy.mockRejectedValue(new Error('platform failed'));
  await expect(
    handlers.applyProxy({}, { protocol: 'noProxy' })
  ).rejects.toThrow('platform failed');
});
