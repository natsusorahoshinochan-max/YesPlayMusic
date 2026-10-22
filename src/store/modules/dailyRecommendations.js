import locale from '@/locale';

export default function createDailyRecommendations({ read, getPlayback }) {
  let pending;
  return {
    namespaced: true,
    state: () => ({ tracks: [], status: 'idle' }),
    mutations: {
      reset(state) {
        state.tracks = [];
        state.status = 'idle';
      },
      loading(state) {
        state.status = 'loading';
      },
      loaded(state, tracks) {
        state.tracks = tracks;
        state.status = 'loaded';
      },
      failed(state) {
        state.status = 'error';
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
            commit('loaded', result.data.dailySongs);
          })
          .catch(() => {
            if (isCurrent()) commit('failed');
          })
          .finally(() => {
            if (isCurrent()) pending = null;
          });
        return operation.promise;
      },
      play({ state, rootGetters, dispatch }, startTrackId) {
        if (!rootGetters['session/hasAccount']) {
          return dispatch('showToast', locale.t('toast.needToLogin'), {
            root: true,
          });
        }
        if (state.status !== 'loaded' || !state.tracks.length) return;
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
