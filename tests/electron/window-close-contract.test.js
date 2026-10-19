import { EventEmitter } from 'events';
import { createWindowOperations } from '@/electron/windowOperations';
import { initIpcMain, rememberCloseOption } from '@/electron/ipcMain';
import { ipcMain } from 'electron';
import { ipcRenderer as connectRenderer } from '@/electron/ipcRenderer';
import { createStore } from '@/store';

jest.mock('electron', () => ({
  ipcMain: new (require('events').EventEmitter)(),
}));
jest.mock('@unblockneteasemusic/rust-napi', () => ({ Executor: class {} }));
jest.mock('discord-rich-presence', () => () => ({ updatePresence() {} }));

function setup(platform = 'darwin', option = 'ask') {
  ipcMain.removeAllListeners();
  ipcMain.handle = jest.fn();
  const app = new EventEmitter();
  const win = new EventEmitter();
  win.hide = jest.fn();
  win.webContents = { session: {}, send: jest.fn() };
  const dialog = { showMessageBox: jest.fn() };
  const store = { get: () => option };
  const operations = createWindowOperations({
    app,
    dialog,
    platform,
    getWindow: () => win,
    getCloseOption: () => store.get('settings.closeAppOption'),
    rememberCloseOption: value =>
      win.webContents.send('rememberCloseAppOption', value),
    onError: jest.fn(),
  });
  app.quit = jest.fn(() => {
    app.emit('before-quit');
    win.emit('close', { preventDefault: jest.fn() });
    app.emit('will-quit');
    app.emit('quit');
  });
  win.on('close', operations.close);
  initIpcMain(win, store, new EventEmitter(), operations);
  const close = entrance => {
    const event = { preventDefault: jest.fn() };
    if (entrance === 'native') win.emit('close', event);
    else ipcMain.emit('close', event);
    return event;
  };
  return { app, win, dialog, close, operations };
}

test.each(['native', 'titlebar'])(
  'macOS %s close hides and keeps the application',
  entrance => {
    const { close, win, app, dialog } = setup();
    close(entrance);
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  }
);

test.each(
  ['win32', 'linux'].flatMap(platform =>
    ['native', 'titlebar'].flatMap(entrance =>
      ['exit', 'minimizeToTray'].map(option => [platform, entrance, option])
    )
  )
)(
  '%s %s applies saved %s choice and normal quit cleanup',
  (platform, entrance, option) => {
    const { close, win, app, dialog } = setup(platform, option);
    const cleanup = jest.fn();
    app.on('will-quit', cleanup);
    close(entrance);
    expect(win.hide).toHaveBeenCalledTimes(option === 'minimizeToTray' ? 1 : 0);
    expect(app.quit).toHaveBeenCalledTimes(option === 'exit' ? 1 : 0);
    expect(cleanup).toHaveBeenCalledTimes(option === 'exit' ? 1 : 0);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  }
);

test.each(['win32', 'linux'])(
  '%s entrances share an inquiry, cancel keeps the window usable and permits retry',
  async platform => {
    const { close, win, app, dialog } = setup(platform);
    let answer;
    dialog.showMessageBox.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answer = resolve;
        })
    );
    close('native');
    close('titlebar');
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(win.hide).not.toHaveBeenCalled();
    answer({ response: 2, checkboxChecked: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    dialog.showMessageBox.mockResolvedValueOnce({
      response: 0,
      checkboxChecked: false,
    });
    close('titlebar');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).not.toHaveBeenCalled();
  }
);

test.each(['win32', 'linux'])(
  '%s inquiry failure can retry and remembered quit saves before normal cleanup',
  async platform => {
    const { close, win, app, dialog } = setup(platform);
    dialog.showMessageBox.mockRejectedValueOnce(
      new Error('dialog unavailable')
    );
    close('native');
    await new Promise(resolve => setTimeout(resolve, 0));
    dialog.showMessageBox.mockResolvedValueOnce({
      response: 1,
      checkboxChecked: true,
    });
    close('titlebar');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'rememberCloseAppOption',
      'exit'
    );
    expect(app.quit).toHaveBeenCalledTimes(1);
  }
);

test.each(['darwin', 'win32', 'linux'])(
  '%s explicit quit bypasses inquiry, including outstanding dialog results',
  async platform => {
    const { close, app, win, dialog, operations } = setup(platform);
    let answer;
    dialog.showMessageBox.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve;
        })
    );
    if (platform !== 'darwin') close('native');
    const cleanup = jest.fn();
    app.on('quit', cleanup);
    operations.quit();
    operations.quit();
    close('titlebar');
    if (answer) answer({ response: 0, checkboxChecked: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(win.hide).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
  }
);

test('remembered exit waits for the renderer complete preference operation and saves the existing settings representation', async () => {
  const { app, win, dialog } = setup('win32');
  const values = new Map([['settings', JSON.stringify({ extension: 'kept' })]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const rendererStore = createStore({ storage });
  const renderer = new EventEmitter();
  renderer.send = (channel, ...args) =>
    ipcMain.emit(channel, { sender: win.webContents }, ...args);
  win.webContents = new EventEmitter();
  win.webContents.send = (channel, ...args) =>
    renderer.emit(channel, {}, ...args);
  window.require = name =>
    name === 'os' ? { platform: () => 'win32' } : { ipcRenderer: renderer };
  const disconnect = connectRenderer({});
  const operations = createWindowOperations({
    app,
    dialog,
    platform: 'win32',
    getWindow: () => win,
    getCloseOption: () =>
      rendererStore.getters['preferences/settings'].closeAppOption,
    rememberCloseOption: value => rememberCloseOption(win, value),
    onError: error => {
      throw error;
    },
  });
  win.removeAllListeners('close');
  win.on('close', operations.close);
  ipcMain.removeAllListeners('close');
  initIpcMain(win, { get() {} }, new EventEmitter(), operations);
  dialog.showMessageBox.mockResolvedValueOnce({
    response: 1,
    checkboxChecked: true,
  });
  const savedAtQuit = [];
  app.on('before-quit', () =>
    savedAtQuit.push(JSON.parse(storage.getItem('settings')))
  );
  ipcMain.emit('close', {});
  expect(app.quit).not.toHaveBeenCalled();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(savedAtQuit).toEqual([
    expect.objectContaining({ closeAppOption: 'exit', extension: 'kept' }),
  ]);
  expect(app.quit).toHaveBeenCalledTimes(1);
  disconnect();
  delete window.require;
});
