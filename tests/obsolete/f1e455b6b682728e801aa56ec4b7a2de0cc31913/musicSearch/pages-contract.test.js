import 'fake-indexeddb/auto';
import Vue from 'vue';
import { shallowMount } from '@vue/test-utils';
import Search from '@/views/search.vue';
import SearchType from '@/views/searchType.vue';
import { createStore } from '@/store';
import { initializeLocale } from '@/locale';
import { configureMusicData } from '@/application/musicData';
import { configureRequest } from '@/utils/request';
import request from '@/utils/request';

const flush = async () => {
  for (let n = 0; n < 4; n++)
    await new Promise(resolve => setTimeout(resolve, 0));
  await Vue.nextTick();
};
test('real page integration owns independent queries, follows route changes, and paginates', async () => {
  const store = createStore({
    storage: { getItem: () => null, setItem() {} },
    credentials: { get: () => null },
    language: 'en',
  });
  configureMusicData({
    getSettings: () => ({ cacheLimit: false }),
    getIdentity: () => ({ hasAccount: false }),
  });
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: '', configure: config => config },
  });
  request.defaults.adapter = async config => ({
    data: {
      result:
        config.params.type === 100
          ? {
              artists: [
                { id: config.params.offset || 1, name: config.params.keywords },
              ],
              hasMore: !config.params.offset,
            }
          : {},
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
  const overviewRoute = Vue.observable({ params: { keywords: 'overview' } });
  const categoryRoute = Vue.observable({
    params: { keywords: 'category', type: 'artists' },
  });
  const mountPage = (component, route) =>
    shallowMount(component, {
      store,
      i18n: initializeLocale('en'),
      mocks: { $route: route },
      stubs: { 'router-link': true, 'svg-icon': true },
    });
  const overview = mountPage(Search, overviewRoute);
  const category = mountPage(SearchType, categoryRoute);
  await flush();
  expect(
    overview.findComponent({ name: 'CoverRow' }).props('items')[0].name
  ).toBe('overview');
  expect(
    category.findComponent({ name: 'CoverRow' }).props('items')[0].name
  ).toBe('category');
  await category
    .find('.load-more')
    .element.firstElementChild.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  await flush();
  expect(
    category.findComponent({ name: 'CoverRow' }).props('items')
  ).toHaveLength(2);
  categoryRoute.params.keywords = 'replaced';
  await flush();
  expect(category.findComponent({ name: 'CoverRow' }).props('items')).toEqual([
    { id: 1, name: 'replaced' },
  ]);
  overviewRoute.params.keywords = '';
  await flush();
  expect(overview.findComponent({ name: 'CoverRow' }).props('items')).toEqual(
    []
  );
  expect(overview.find('.no-results').isVisible()).toBe(true);
  overview.destroy();
  category.destroy();
});

test.each(
  [Search, SearchType].flatMap(component =>
    ['success', 'failure', 'dispose'].map(outcome => [
      component.name,
      outcome,
      component,
    ])
  )
)('%s progress finishes after %s', async (_name, outcome, component) => {
  jest.useFakeTimers();
  const progress = require('nprogress');
  const start = jest.spyOn(progress, 'start').mockImplementation(() => {});
  const done = jest.spyOn(progress, 'done').mockImplementation(() => {});
  const pending = [];
  request.defaults.adapter = () =>
    new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  const store = createStore({
    storage: { getItem: () => null, setItem() {} },
    language: 'en',
  });
  configureMusicData({
    getSettings: () => ({ cacheLimit: false }),
    getIdentity: () => ({ hasAccount: false }),
  });
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: '', configure: config => config },
  });
  const page = shallowMount(component, {
    store,
    i18n: initializeLocale('en'),
    mocks: { $route: { params: { keywords: 'progress', type: 'artists' } } },
    stubs: { 'router-link': true, 'svg-icon': true },
  });
  const settle = async () => {
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
    await Vue.nextTick();
  };
  try {
    await settle();
    expect(start).not.toHaveBeenCalled();
    if (outcome === 'success') {
      jest.advanceTimersByTime(1000);
      expect(start).toHaveBeenCalledTimes(1);
      pending.forEach(({ resolve }) =>
        resolve({ data: { result: { artists: [] } }, status: 200, headers: {} })
      );
    } else if (outcome === 'failure') {
      pending.forEach(({ reject }) => reject(new Error('Search unavailable')));
    } else {
      page.destroy();
    }
    await settle();
    expect(done).toHaveBeenCalled();
    const starts = start.mock.calls.length;
    jest.advanceTimersByTime(2000);
    expect(start).toHaveBeenCalledTimes(starts);
  } finally {
    page.destroy();
    jest.useRealTimers();
  }
});
