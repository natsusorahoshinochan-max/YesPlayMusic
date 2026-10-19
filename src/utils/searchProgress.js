import NProgress from 'nprogress';

export function createSearchProgress() {
  let timer;
  const finish = () => {
    clearTimeout(timer);
    timer = undefined;
    NProgress.done();
  };
  return {
    update(loading) {
      if (!loading) return finish();
      clearTimeout(timer);
      timer = setTimeout(() => NProgress.start(), 1000);
    },
    dispose: finish,
  };
}
