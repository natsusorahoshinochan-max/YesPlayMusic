export function createWindowOperations({
  app,
  dialog,
  platform,
  getWindow,
  getCloseOption,
  rememberCloseOption,
  onError,
}) {
  let quitting = false;
  let inquiry = null;
  app.on('before-quit', () => {
    quitting = true;
  });

  function quit() {
    if (quitting) return;
    quitting = true;
    app.quit();
  }

  function close(event) {
    if (quitting) return;
    if (event) event.preventDefault();
    if (inquiry) return inquiry;
    const option = getCloseOption();
    if (platform === 'darwin' || option === 'minimizeToTray') {
      getWindow().hide();
    } else if (option === 'exit') {
      quit();
    } else {
      inquiry = (async () => {
        try {
          const result = await dialog.showMessageBox(getWindow(), {
            type: 'info',
            title: 'Information',
            cancelId: 2,
            defaultId: 0,
            message: '确定要关闭吗？',
            buttons: ['最小化到托盘', '直接退出', '取消'],
            checkboxLabel: '记住我的选择',
          });
          if (quitting || ![0, 1].includes(result.response)) return;
          if (result.checkboxChecked) {
            await rememberCloseOption(
              result.response === 0 ? 'minimizeToTray' : 'exit'
            );
          }
          if (quitting) return;
          if (result.response === 0) getWindow().hide();
          else quit();
        } catch (error) {
          onError(error);
        }
      })().finally(() => {
        inquiry = null;
      });
      return inquiry;
    }
  }
  return { close, quit };
}
