import Vue from 'vue';
import { search } from '@/api/others';

const categories = ['tracks', 'artists', 'albums', 'musicVideos', 'playlists'];
const emptyResults = () =>
  Object.fromEntries(categories.map(category => [category, []]));

export function createMusicSearchQuery({
  subscribeIdentity,
  onError = () => {},
} = {}) {
  const state = Vue.observable({
    results: emptyResults(),
    loading: false,
    loaded: false,
    nextOffset: null,
    get hasMore() {
      return this.nextOffset !== null;
    },
  });
  let generation = 0;
  let identityGeneration = 0;
  let disposed = false;
  let intent;
  const jobs = new Set();
  const current = job =>
    !disposed &&
    job.generation === generation &&
    (job.category !== 'tracks' ||
      job.identityGeneration === identityGeneration);
  function updateLoading() {
    state.loading = [...jobs].some(current);
    if (!state.loading) state.loaded = true;
  }
  const unsubscribe = subscribeIdentity?.(() => {
    identityGeneration++;
    state.results.tracks = [];
    if (intent?.category === 'tracks') state.nextOffset = null;
    updateLoading();
  });
  async function readPage(category, limit) {
    const job = {
      generation,
      identityGeneration,
      category,
    };
    jobs.add(job);
    state.loading = true;
    const position = state.nextOffset ?? 0;
    try {
      const isCurrent = () =>
        current(job) && job.identityGeneration === identityGeneration;
      const { items, nextOffset } = await search(
        {
          keywords: intent.keywords,
          category,
          offset: position,
          limit,
        },
        { isCurrent }
      );
      if (!current(job)) return;
      state.results[category] = state.results[category].concat(items);
      if (intent.category !== 'overview') {
        state.nextOffset = nextOffset;
      }
    } catch (error) {
      if (current(job)) onError(error);
    } finally {
      jobs.delete(job);
      if (!disposed && job.generation === generation) updateLoading();
    }
  }
  return {
    state,
    replace(next) {
      if (disposed) return Promise.resolve();
      generation++;
      intent = next;
      state.results = emptyResults();
      state.loaded = false;
      state.loading = false;
      state.nextOffset = null;
      if (
        !next.keywords ||
        (!categories.includes(next.category) && next.category !== 'overview')
      ) {
        state.loaded = true;
        return Promise.resolve();
      }
      return next.category === 'overview'
        ? Promise.all(categories.map(category => readPage(category, 16)))
        : readPage(next.category);
    },
    loadNext() {
      if (
        disposed ||
        state.loading ||
        !state.hasMore ||
        intent?.category === 'overview'
      )
        return Promise.resolve();
      return readPage(intent.category);
    },
    dispose() {
      disposed = true;
      generation++;
      state.loading = false;
      unsubscribe?.();
      jobs.clear();
    },
  };
}
