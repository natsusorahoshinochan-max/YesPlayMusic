import { createMusicSearchQuery } from '@/musicSearch/query';

export function createMusicSearch(store) {
  const getIdentity = () => ({
    mode: store.state.session.loginMode,
    hasAccount: store.getters['session/hasAccount'],
    userId: store.getters['library/user'].userId,
    vipType: store.getters['library/user'].vipType,
  });
  return createMusicSearchQuery({
    getIdentity,
    subscribeIdentity: changed =>
      store.watch(getIdentity, changed, { deep: true, sync: true }),
    onError: error =>
      store.dispatch(
        'showToast',
        error.response?.data?.msg ||
          error.response?.data?.message ||
          error.message
      ),
  });
}
