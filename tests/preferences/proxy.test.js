import { createStore } from '@/store';

function setup() {
  const values = {
    settings: JSON.stringify({
      proxyConfig: {
        protocol: 'HTTP',
        server: 'old',
        port: 80,
        extension: { token: 42 },
      },
    }),
  };
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const applyProxy = jest.fn();
  const store = createStore({ storage, preferences: { applyProxy } });
  return { values, storage, applyProxy, store };
}

test('代理完整提交保留扩展并应用；重复显式提交仍应用且不重复保存；关闭提交关闭状态', async () => {
  const { store, storage, values, applyProxy } = setup();
  await store.dispatch('preferences/applyRestored');
  expect(applyProxy).not.toHaveBeenCalled();
  storage.setItem.mockClear();
  const config = { protocol: 'HTTPS', server: 'new', port: 443 };
  await store.dispatch('preferences/submitProxy', config);
  expect(store.getters['preferences/settings'].proxyConfig).toEqual({
    ...config,
    extension: { token: 42 },
  });
  expect(JSON.parse(values.settings).proxyConfig).toEqual({
    ...config,
    extension: { token: 42 },
  });
  expect(applyProxy).toHaveBeenCalledTimes(1);
  storage.setItem.mockClear();
  await store.dispatch('preferences/submitProxy', config);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(applyProxy).toHaveBeenCalledTimes(2);
  await store.dispatch('preferences/disableProxy');
  expect(JSON.parse(values.settings).proxyConfig.protocol).toBe('noProxy');
  expect(applyProxy).toHaveBeenLastCalledWith(
    expect.objectContaining({ protocol: 'noProxy' })
  );
});

test('代理空配置提交关闭状态；操作等待应用并向调用者报告存储异常', async () => {
  const { store, applyProxy, storage, values } = setup();
  let finish;
  applyProxy.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  let completed = false;
  const submission = store
    .dispatch('preferences/submitProxy', {
      protocol: 'HTTP',
      server: '',
      port: '',
    })
    .then(() => {
      completed = true;
    });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse(values.settings).proxyConfig).toMatchObject({
    protocol: 'noProxy',
    server: '',
    port: null,
  });
  expect(completed).toBe(false);
  finish();
  await submission;
  storage.setItem.mockImplementation(() => {
    throw new Error('disk unavailable');
  });
  applyProxy.mockClear();
  await expect(
    store.dispatch('preferences/submitProxy', {
      protocol: 'HTTP',
      server: 'other',
      port: 80,
    })
  ).rejects.toThrow('disk unavailable');
  expect(applyProxy).not.toHaveBeenCalled();
});
