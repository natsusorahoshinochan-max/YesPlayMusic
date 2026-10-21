import Vue from 'vue';
import { search } from '@/api/others';
import { getTrackDetail } from '@/api/track';

const categories = ['tracks', 'artists', 'albums', 'musicVideos', 'playlists'];
const emptyResults = () =>
  Object.fromEntries(categories.map(category => [category, []]));

export function createMusicSearchQuery({
  getIdentity = () => null,
  subscribeIdentity,
  onError = () => {},
} = {}) {
  const state = Vue.observable({
    results: emptyResults(),
    loading: false,
    loaded: false,
    hasMore: false,
    error: null,
  });
  let generation = 0;
  let identityGeneration = 0;
  let disposed = false;
  let intent;
  let offset = 0;
  const jobs = new Set();
  const current = job =>
    !disposed &&
    job.generation === generation &&
    (job.category !== 'tracks' ||
      (job.identityGeneration === identityGeneration &&
        job.identity === JSON.stringify(getIdentity())));
  function updateLoading() {
    state.loading = [...jobs].some(current);
    if (!state.loading) state.loaded = true;
  }
  const unsubscribe = subscribeIdentity?.(() => {
    identityGeneration++;
    state.results.tracks = [];
    if (intent?.category === 'tracks') state.hasMore = false;
    updateLoading();
  });
  async function readPage(category, limit) {
    const job = {
      generation,
      identityGeneration,
      identity: JSON.stringify(getIdentity()),
      category,
    };
    jobs.add(job);
    state.loading = true;
    const position = offset;
    try {
      const isCurrent = () =>
        current(job) &&
        job.identityGeneration === identityGeneration &&
        job.identity === JSON.stringify(getIdentity());
      const { items: page, hasMore } = await search(
        {
          keywords: intent.keywords,
          category,
          offset: position,
          limit,
        },
        { isCurrent }
      );
      if (!current(job)) return;
      let items = page;
      if (category === 'tracks' && page.length) {
        const details = await getTrackDetail(
          page.map(track => track.id).join(','),
          { isCurrent }
        );
        if (!current(job)) return;
        items = details.songs;
      }
      if (!current(job)) return;
      state.results[category] = state.results[category].concat(items);
      if (intent.category !== 'overview') {
        offset = position + page.length;
        state.hasMore = hasMore;
      }
    } catch (error) {
      if (current(job)) {
        state.error = error;
        onError(error);
      }
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
      offset = 0;
      state.results = emptyResults();
      state.error = null;
      state.loaded = false;
      state.loading = false;
      state.hasMore = false;
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
      state.error = null;
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
