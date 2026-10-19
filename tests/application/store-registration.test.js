/** @jest-environment node */

// Base store construction is available before browser and HTTP adapters exist.
import { createStore } from '@/store';

test('isolated store registers all owners without a browser or production requests', async () => {
  const values = new Map();
  const store = createStore({
    language: 'en',
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
  });
  expect(store.getters['lastfm/authorization']).toEqual({});
  expect(store.state.dailyRecommendations.status).toBe('idle');
  await store.dispatch('lastfm/disconnect');
  await store.dispatch('dailyRecommendations/load');
  expect(store.state.dailyRecommendations.tracks).toEqual([]);
});
