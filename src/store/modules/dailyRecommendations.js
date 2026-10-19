export default function createDailyRecommendations({ read, getPlayback }) {
  let pending;
  return {
    namespaced: true,
    state: () => ({ tracks: [], status: 'idle', error: null }),
    mutations: {
      reset(state) {
        state.tracks = [];
        state.status = 'idle';
        state.error = null;
      },
      loading(state) {
        state.status = 'loading';
        state.error = null;
      },
      loaded(state, tracks) {
        state.tracks = tracks;
        state.status = 'loaded';
      },
      failed(state, error) {
        state.status = 'error';
        state.error = error;
      },
    },
    actions: {
      identityChanged({ commit }) {
        pending = null;
        commit('reset');
      },
      load({ state, rootGetters, commit }) {
        if (!rootGetters['session/hasAccount'] || state.status === 'loaded')
          return;
        if (pending) return pending.promise;
        const operation = {};
        pending = operation;
        const isCurrent = () => pending === operation;
        commit('loading');
        operation.promise = Promise.resolve()
          .then(() => read({ isCurrent }))
          .then(result => {
            if (!isCurrent()) return;
            if (!Array.isArray(result?.data?.dailySongs))
              throw new Error('Daily recommendations unavailable');
            commit('loaded', result.data.dailySongs);
          })
          .catch(error => {
            if (isCurrent()) commit('failed', error);
          })
          .finally(() => {
            if (isCurrent()) pending = null;
          });
        return operation.promise;
      },
      play({ state, rootGetters }, startTrackId) {
        if (
          !rootGetters['session/hasAccount'] ||
          state.status !== 'loaded' ||
          !state.tracks.length
        )
          return;
        return getPlayback().playTracks(
          state.tracks.map(track => track.id),
          {
            source: { type: 'url', id: '/daily/songs' },
            startTrackId: startTrackId ?? state.tracks[0].id,
          }
        );
      },
    },
  };
}
