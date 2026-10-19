import { createStore } from '@/store';
import { createPreferenceEffects } from '@/application/preferenceEffects';

test('桌面代理提交返回平台异步结果，拒绝沿公开 action 返回；恢复不提交 renderer 代理', async () => {
  const invoke = jest.fn().mockRejectedValue(new Error('proxy unavailable'));
  const values = {};
  const store = createStore({
    storage: {
      getItem: key => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      },
    },
    preferences: createPreferenceEffects({
      getLocale: () => ({}),
      ipcRenderer: { invoke, send: jest.fn() },
    }),
  });
  window.matchMedia = () => ({ matches: false });
  document.head.innerHTML = '<meta name="theme-color" content="#fff">';
  await store.dispatch('preferences/applyRestored');
  expect(invoke).not.toHaveBeenCalled();
  await expect(
    store.dispatch('preferences/submitProxy', {
      protocol: 'HTTP',
      server: 'saved',
      port: '80',
    })
  ).rejects.toThrow('proxy unavailable');
  expect(invoke).toHaveBeenCalledWith(
    'applyProxy',
    expect.objectContaining({ protocol: 'HTTP', server: 'saved', port: 80 })
  );
});
