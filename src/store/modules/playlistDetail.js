export default function createPlaylistDetail({ api = {} } = {}) {
  let pending;

  async function loadMore(context, { count = 100 } = {}) {
    const detail = context.state.current;
    if (!detail || !detail.playlist || !detail.hasMore || count <= 0) return;
    if (pending?.detail === detail) {
      await pending.promise;
      if (context.state.current !== detail) return;
      return loadMore(context, { count });
    }
    const batch = detail.playlist.trackIds
      .slice(detail.traversed, detail.traversed + count)
      .map(track => track.id);
    context.commit('patch', { loadingMore: true });
    const promise = (async () => {
      try {
        const result = await api.getTrackDetail(batch.join(','));
        if (context.state.current !== detail) return;
        context.commit('append', { batch, tracks: result.songs });
      } finally {
        if (context.state.current === detail) {
          context.commit('patch', { loadingMore: false });
        }
      }
    })();
    pending = { detail, promise };
    try {
      await promise;
    } finally {
      if (pending?.promise === promise) pending = undefined;
    }
  }

  async function open(context, id, range) {
    const current = context.state.current;
    const retained = Number(current?.id) === Number(id) ? current : null;
    context.commit('replace', {
      id,
      playlist: null,
      tracks: [],
      hasMore: false,
      traversed: 0,
      ...(retained || {}),
      confirmedFavorite: retained?.confirmedFavorite,
      loading: true,
      loadingMore: false,
    });
    const detail = context.state.current;
    try {
      const result = await api.getPlaylistDetail(id, true);
      if (context.state.current !== detail) return;
      const playlist = result.playlist;
      const tracks = playlist.tracks || [];
      const initial = tracks.reduce((end, track) => {
        const index = playlist.trackIds.findIndex(item => item.id === track.id);
        return Math.max(end, index + 1);
      }, 0);
      const available = new Map(
        [...detail.tracks, ...tracks].map(track => [track.id, track])
      );
      context.commit('patch', {
        playlist: {
          ...playlist,
          tracks: undefined,
          ...(context.state.current.confirmedFavorite === undefined
            ? {}
            : {
                subscribed: context.state.current.confirmedFavorite,
              }),
        },
        tracks: playlist.trackIds
          .map(track => available.get(track.id))
          .filter(Boolean),
        traversed: initial,
        hasMore: initial < playlist.trackIds.length,
      });
      await loadMore(context, {
        count: range === undefined ? 100 : Math.max(0, range - initial),
      });
    } finally {
      if (context.state.current === detail) {
        context.commit('patch', { loading: false });
      }
    }
  }

  return {
    namespaced: true,
    state: () => ({ current: null }),
    getters: { current: state => state.current },
    mutations: {
      replace(state, detail) {
        state.current = detail;
      },
      patch(state, patch) {
        Object.assign(state.current, patch);
      },
      append(state, { batch, tracks }) {
        const detail = state.current;
        const valid = new Set(detail.playlist.trackIds.map(track => track.id));
        const available = new Map(
          [...detail.tracks, ...tracks]
            .filter(track => valid.has(track.id))
            .map(track => [track.id, track])
        );
        detail.traversed += batch.filter(id => valid.has(id)).length;
        detail.tracks = detail.playlist.trackIds
          .map(track => available.get(track.id))
          .filter(Boolean);
        detail.hasMore = detail.traversed < detail.playlist.trackIds.length;
      },
      removeTracks(state, trackIds) {
        const detail = state.current;
        const removed = new Set(trackIds);
        const ids = detail.playlist.trackIds;
        const removedBefore = ids
          .slice(0, detail.traversed)
          .filter(track => removed.has(track.id)).length;
        const remaining = ids.filter(track => !removed.has(track.id));
        detail.playlist = {
          ...detail.playlist,
          trackIds: remaining,
          trackCount: Math.max(
            0,
            detail.playlist.trackCount - (ids.length - remaining.length)
          ),
        };
        detail.traversed -= removedBefore;
        detail.tracks = detail.tracks.filter(track => !removed.has(track.id));
        detail.hasMore = detail.traversed < remaining.length;
      },
    },
    actions: {
      open: (context, id) => open(context, id),
      loadMore,
      close({ commit }) {
        commit('replace', null);
      },
      async applyLibraryChange(context, change) {
        const detail = context.state.current;
        if (!detail || Number(detail.id) !== Number(change.playlistId)) return;
        if (change.type === 'deleted') return context.dispatch('close');
        if (change.type === 'favorite') {
          context.commit('patch', {
            confirmedFavorite: change.favorite,
            ...(detail.playlist
              ? {
                  playlist: { ...detail.playlist, subscribed: change.favorite },
                }
              : {}),
          });
        }
        if (!detail.playlist) {
          return open(context, detail.id);
        }
        if (change.type === 'tracks-removed') {
          context.commit('removeTracks', change.trackIds);
        } else if (change.type === 'favorite') {
          const result = await api.getPlaylistDetail(detail.id, true);
          if (context.state.current === detail) {
            context.commit('patch', {
              playlist: {
                ...result.playlist,
                trackIds: detail.playlist.trackIds,
                trackCount: detail.playlist.trackCount,
                tracks: undefined,
                subscribed: detail.confirmedFavorite,
              },
            });
          }
        } else if (change.type === 'tracks-added' || change.type === 'reload') {
          return open(context, detail.id, detail.traversed);
        }
      },
    },
  };
}
