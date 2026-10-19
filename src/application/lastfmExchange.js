// Each renderer owns its existing cross-window storage handoff.
export function createLastfmExchange({ storage, window: host = window }) {
  let release;
  const stop = () => {
    release?.();
    release = undefined;
  };
  return {
    stop,
    start(adopt) {
      stop();
      const check = () => {
        const authorization = storage.read();
        if (authorization.key === undefined) return;
        stop();
        adopt(authorization);
      };
      const onStorage = event => {
        if (event.key === 'lastfm') check();
      };
      const timer = host.setInterval(check, 1000);
      host.addEventListener('storage', onStorage);
      host.addEventListener('beforeunload', stop);
      release = () => {
        host.clearInterval(timer);
        host.removeEventListener('storage', onStorage);
        host.removeEventListener('beforeunload', stop);
      };
    },
  };
}
