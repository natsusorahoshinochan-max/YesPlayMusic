import Player from '@/utils/Player';

export function createPlayer() {
  return new Proxy(new Player(), {
    set(target, prop, value) {
      target[prop] = value;
      if (prop === '_howler') return true;
      target.saveSelfToLocalStorage();
      target.sendSelfToIpcMain();
      return true;
    },
  });
}
