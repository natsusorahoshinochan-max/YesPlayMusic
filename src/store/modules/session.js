export default function createSession(
  snapshot,
  {
    credentials,
    auth = {},
    navigate = () => {},
    notify = () => {},
    now = () => new Date(),
  }
) {
  async function clearIdentity({ commit, dispatch }) {
    credentials.remove('MUSIC_U');
    credentials.remove('__csrf');
    commit('setIdentity', { loginMode: null, hasCredential: false });
    await dispatch('library/clearIdentity', null, { root: true });
  }

  return {
    namespaced: true,
    state: () => ({
      ...snapshot,
      hasCredential: Boolean(credentials.get('MUSIC_U')),
    }),
    getters: {
      hasAccount: state => state.loginMode === 'account' && state.hasCredential,
      hasLibraryIdentity: (state, getters) =>
        getters.hasAccount || state.loginMode === 'username',
    },
    mutations: {
      setIdentity(state, { loginMode, hasCredential }) {
        state.loginMode = loginMode;
        state.hasCredential = hasCredential;
      },
      setLastRefreshCookieDate(state, value) {
        state.lastRefreshCookieDate = value;
      },
    },
    actions: {
      restore({ state, commit }) {
        commit('setIdentity', {
          loginMode: state.loginMode,
          hasCredential: Boolean(credentials.get('MUSIC_U')),
        });
      },
      acceptCredentials({ commit }, cookie) {
        credentials.set(cookie);
        commit('setIdentity', {
          loginMode: 'account',
          hasCredential: Boolean(credentials.get('MUSIC_U')),
        });
      },
      selectPublicIdentity({ commit }, user) {
        commit('setIdentity', {
          loginMode: 'username',
          hasCredential: Boolean(credentials.get('MUSIC_U')),
        });
        commit('library/setUser', user, { root: true });
      },
      async refreshDaily({ state, getters, commit }) {
        if (
          !getters.hasAccount ||
          state.lastRefreshCookieDate === now().getDate() ||
          !auth.refreshCookie
        )
          return;
        await auth.refreshCookie();
        commit('setLastRefreshCookieDate', now().getDate());
      },
      async invalidate(context) {
        await clearIdentity(context);
        notify('登录状态已失效，请重新登录');
        return navigate('invalidated');
      },
      async logout(context) {
        try {
          if (auth.logout) Promise.resolve(auth.logout()).catch(() => {});
        } catch {
          // Local exit remains available when the remote service cannot respond.
        }
        await clearIdentity(context);
        return navigate('logout');
      },
    },
  };
}
