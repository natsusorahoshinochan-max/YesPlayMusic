import locale from '@/locale';

export function describeLibraryOutcome(outcome) {
  if (outcome.status === 'denied') return locale.t('toast.needToLogin');
  if (outcome.message) return outcome.message;
  return outcome.status === 'unconfirmed'
    ? '未能确认操作结果，请稍后刷新查看'
    : '操作失败';
}
