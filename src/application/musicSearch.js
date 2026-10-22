import { createMusicSearchQuery } from '@/musicSearch/query';
import { readIdentity } from '@/api/readingContext';

export function createMusicSearch(store) {
  return createMusicSearchQuery({
    subscribeIdentity: changed => {
      const stopTransition = store.subscribeIdentityChanges(changed);
      const stopProfile = store.watch(readIdentity, changed, {
        deep: true,
        sync: true,
      });
      return () => {
        stopTransition();
        stopProfile();
      };
    },
    onError: error =>
      store.dispatch(
        'showToast',
        error.response?.data?.msg ||
          error.response?.data?.message ||
          error.message
      ),
  });
}
