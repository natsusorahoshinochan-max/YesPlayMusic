import { ipcMain } from 'electron';
import unblockMusic from './unblockMusic';
import { applyDesktopShortcuts } from './preferences';
import { registerProxy } from './proxy';
import { isCreateTray } from '@/utils/platform';

const client = require('discord-rich-presence')('818936529484906596');

let closePreferenceRequest = 0;

// The renderer acknowledges the existing complete preferences operation before
// the main process continues with an exit selected in the close dialog.
export function rememberCloseOption(win, value) {
  return new Promise((resolve, reject) => {
    const contents = win.webContents;
    const requestId = ++closePreferenceRequest;
    const cleanup = () => {
      ipcMain.removeListener('rememberCloseAppOptionFinished', finished);
      contents.removeListener('destroyed', contextLost);
      contents.removeListener('render-process-gone', contextLost);
      contents.removeListener('did-start-navigation', navigating);
      clearTimeout(timeout);
    };
    const contextLost = () => {
      cleanup();
      reject(new Error('Renderer unavailable before saving close preference'));
    };
    const navigating = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) contextLost();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out saving close preference'));
    }, 5000);
    const finished = (event, error, completedRequestId) => {
      if (event.sender !== contents || completedRequestId !== requestId) return;
      cleanup();
      if (error) reject(new Error(error));
      else resolve();
    };
    ipcMain.on('rememberCloseAppOptionFinished', finished);
    contents.once('destroyed', contextLost);
    contents.once('render-process-gone', contextLost);
    contents.on('did-start-navigation', navigating);
    try {
      contents.send('rememberCloseAppOption', value, requestId);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function initIpcMain(win, store, trayEventEmitter, windowOperations) {
  ipcMain.handle('unblock-music', (_, track, preferences) =>
    unblockMusic(track, preferences)
  );

  ipcMain.on('close', () => windowOperations.close());

  ipcMain.on('minimize', () => {
    win.minimize();
  });

  ipcMain.on('maximizeOrUnmaximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.on('settings', (event, options) => {
    store.set('settings', options);
  });

  ipcMain.on('playDiscordPresence', (event, track) => {
    client.updatePresence({
      details: track.name + ' - ' + track.ar.map(ar => ar.name).join(','),
      state: track.al.name,
      endTimestamp: Date.now() + track.dt,
      largeImageKey: track.al.picUrl,
      largeImageText: 'Listening ' + track.name,
      smallImageKey: 'play',
      smallImageText: 'Playing',
      instance: true,
    });
  });

  ipcMain.on('pauseDiscordPresence', (event, track) => {
    client.updatePresence({
      details: track.name + ' - ' + track.ar.map(ar => ar.name).join(','),
      state: track.al.name,
      largeImageKey: track.al.picUrl,
      largeImageText: 'YesPlayMusic',
      smallImageKey: 'pause',
      smallImageText: 'Pause',
      instance: true,
    });
  });

  registerProxy(ipcMain, win.webContents.session, store);

  ipcMain.on('applyShortcuts', (_, control, updateMenu) => {
    applyDesktopShortcuts(win, store, control, updateMenu);
  });

  if (isCreateTray) {
    ipcMain.on('updateTrayTooltip', (_, title) => {
      trayEventEmitter.emit('updateTooltip', title);
    });
    ipcMain.on('updateTrayPlayState', (_, isPlaying) => {
      trayEventEmitter.emit('updatePlayState', isPlaying);
    });
    ipcMain.on('updateTrayLikeState', (_, isLiked) => {
      trayEventEmitter.emit('updateLikeState', isLiked);
    });
    ipcMain.on('updateTrayIcon', () => {
      trayEventEmitter.emit('updateIcon');
    });
  }
}
