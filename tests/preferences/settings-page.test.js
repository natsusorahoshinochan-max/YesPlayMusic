import { shallowMount, createLocalVue } from '@vue/test-utils';
import Vuex from 'vuex';
import Settings from '@/views/settings.vue';
import { createStore } from '@/store';
import { createPreferenceEffects } from '@/application/preferenceEffects';

jest.mock(
  'dexie',
  () =>
    class {
      constructor() {
        this.trackSources = { each: () => Promise.resolve() };
      }
      version() {
        return { stores: () => ({ upgrade: () => {} }) };
      }
    }
);

test('设置页面输入通过完整动作保存并应用语言、外观与主题', async () => {
  const values = {};
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const locale = { locale: '' };
  window.matchMedia = () => ({ matches: false });
  document.head.innerHTML = '<meta name="theme-color" content="#fff">';
  const store = createStore({
    storage,
    preferences: createPreferenceEffects({ getLocale: () => locale }),
  });
  const localVue = createLocalVue();
  localVue.use(Vuex);
  const wrapper = shallowMount(Settings, {
    localVue,
    store,
    mocks: { $t: key => key },
    stubs: ['router-link', 'svg-icon'],
  });
  const selects = wrapper.findAll('select');
  await selects.at(0).setValue('tr');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(locale.locale).toBe('tr');
  expect(JSON.parse(values.settings).lang).toBe('tr');
  await selects.at(1).setValue('dark');
  await selects.at(2).setValue('ocean');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.body.getAttribute('data-theme')).toBe('dark');
  expect(document.body.style.getPropertyValue('--color-primary')).toBe(
    '#5aa2ff'
  );
  expect(JSON.parse(values.settings)).toMatchObject({
    appearance: 'dark',
    themeColor: 'ocean',
  });
  wrapper.destroy();
});

test('设置保存异常由页面提示并消费拒绝', async () => {
  const values = {};
  const notices = [];
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
  };
  const store = createStore({
    storage,
    actions: { showToast: (context, message) => notices.push(message) },
  });
  await store.dispatch('preferences/applyRestored');
  const localVue = createLocalVue();
  localVue.use(Vuex);
  const wrapper = shallowMount(Settings, {
    localVue,
    store,
    mocks: { $t: key => key },
    stubs: ['router-link', 'svg-icon'],
  });
  storage.setItem.mockRejectedValue(new Error('disk unavailable'));
  await wrapper.findAll('select').at(0).setValue('tr');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(notices).toEqual(['disk unavailable']);
  wrapper.destroy();
});

test('代理编辑只更新页面完整草稿，更新与关闭提交后才改变已保存配置', async () => {
  process.env.IS_ELECTRON = true;
  window.require = () => ({ ipcRenderer: { send: jest.fn() } });
  navigator.mediaDevices = { enumerateDevices: () => Promise.resolve([]) };
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
    setItem: (key, value) => {
      values[key] = value;
    },
  };
  const applyProxy = jest.fn();
  const store = createStore({ storage, preferences: { applyProxy } });
  const localVue = createLocalVue();
  localVue.use(Vuex);
  const wrapper = shallowMount(Settings, {
    localVue,
    store,
    mocks: { $t: key => key },
    stubs: ['router-link', 'svg-icon'],
  });
  const form = wrapper.find('#proxy-form');
  await form.findAll('input').at(0).setValue('new');
  await form.find('input[type="number"]').setValue('8080');
  expect(store.getters['preferences/settings'].proxyConfig.server).toBe('old');
  expect(JSON.parse(values.settings).proxyConfig.server).toBe('old');
  expect(applyProxy).not.toHaveBeenCalled();
  await form.find('button').trigger('click');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse(values.settings).proxyConfig).toMatchObject({
    server: 'new',
    port: 8080,
    extension: { token: 42 },
  });
  await wrapper
    .findAll('select')
    .wrappers.find(select => select.find('option[value="noProxy"]').exists())
    .setValue('noProxy');
  expect(store.getters['preferences/settings'].proxyConfig.protocol).toBe(
    'HTTP'
  );
  await form.find('button').trigger('click');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(applyProxy).toHaveBeenLastCalledWith(
    expect.objectContaining({ protocol: 'noProxy' })
  );
  wrapper.destroy();
  delete process.env.IS_ELECTRON;
});
