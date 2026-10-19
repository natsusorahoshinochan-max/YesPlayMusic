export default function createLastfm({
  storage,
  authGetSession,
  auth,
  exchange,
}) {
  return {
    namespaced: true,
    state: () => ({ authorization: Object.freeze({}) }),
    getters: { authorization: state => state.authorization },
    mutations: {
      setAuthorization(state, authorization) {
        state.authorization = Object.freeze({ ...authorization });
      },
    },
    actions: {
      restore({ commit }) {
        commit('setAuthorization', storage.read());
      },
      connect({ commit }) {
        exchange.start(authorization =>
          commit('setAuthorization', authorization)
        );
        try {
          auth();
        } catch (error) {
          exchange.stop();
          throw error;
        }
      },
      stopConnecting() {
        exchange.stop();
      },
      async completeAuthorization({ commit }, token) {
        const result = await authGetSession(token);
        const authorization = result.data.session;
        if (!authorization?.key) throw new Error('无Session');
        storage.save(authorization);
        exchange.stop();
        commit('setAuthorization', authorization);
        return authorization;
      },
      disconnect({ commit }) {
        exchange.stop();
        storage.remove();
        commit('setAuthorization', {});
      },
    },
  };
}
