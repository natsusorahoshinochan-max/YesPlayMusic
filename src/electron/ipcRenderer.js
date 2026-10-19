import store from '@/store';

export function ipcRenderer(vueInstance) {
  const self = vueInstance;
  // 添加专有的类名
  document.body.setAttribute('data-electron', 'yes');
  document.body.setAttribute(
    'data-electron-os',
    window.require('os').platform()
  );
  // ipc message channel
  const electron = window.require('electron');
  const ipcRenderer = electron.ipcRenderer;

  const listeners = [];
  function listen(channel, handler) {
    ipcRenderer.on(channel, handler);
    listeners.push([channel, handler]);
  }

  // listens to the main process 'changeRouteTo' event and changes the route from
  // inside this Vue instance, according to what path the main process requires.
  // responds to Menu click() events at the main process and changes the route accordingly.

  listen('changeRouteTo', (event, path) => {
    self.$router.push(path);
    if (store.state.showLyrics) {
      store.commit('toggleLyrics');
    }
  });

  listen('search', () => {
    // 触发数据响应
    self.$refs.navbar.$refs.searchInput.focus();
    self.$refs.navbar.inputFocus = true;
  });

  listen('routerGo', (event, where) => {
    self.$refs.navbar.go(where);
  });

  listen('nextUp', () => {
    self.$refs.player.goToNextTracksPage();
  });

  listen('rememberCloseAppOption', async (event, value, requestId) => {
    try {
      await store.dispatch('preferences/setPreference', {
        key: 'closeAppOption',
        value,
      });
      ipcRenderer.send('rememberCloseAppOptionFinished', undefined, requestId);
    } catch (error) {
      ipcRenderer.send(
        'rememberCloseAppOptionFinished',
        error.message || '设置保存失败',
        requestId
      );
      store.dispatch('showToast', error.message || '设置保存失败');
    }
  });

  return () => {
    listeners.forEach(([channel, handler]) =>
      ipcRenderer.removeListener(channel, handler)
    );
  };
}
