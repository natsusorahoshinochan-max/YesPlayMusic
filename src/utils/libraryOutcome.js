import locale from '@/locale';

export function describeLibraryOutcome(outcome) {
  if (outcome.status === 'denied') return locale.t('toast.needToLogin');
  if (outcome.message) return outcome.message;
  return outcome.status === 'unconfirmed'
    ? '未能确认操作结果，请稍后刷新查看'
    : '操作失败';
}

export function showLibraryChangeFeedback(store, result, successMessage) {
  const message =
    result.outcome.status !== 'succeeded'
      ? describeLibraryOutcome(result.outcome)
      : result.synchronization === 'incomplete'
      ? '操作已完成，音乐库部分内容更新失败'
      : successMessage;
  if (message) store.dispatch('showToast', message);
}

export async function toggleTrackFavoriteWithFeedback(store, id) {
  const result = await store.dispatch('library/toggleTrackFavorite', id);
  showLibraryChangeFeedback(store, result);
  return result;
}
