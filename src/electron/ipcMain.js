import { ipcMain } from 'electron';
import UNM from '@unblockneteasemusic/rust-napi';
import { applyDesktopShortcuts } from './preferences';
import { registerProxy } from './proxy';
import { isCreateTray } from '@/utils/platform';

const clc = require('cli-color');
const log = text => {
  console.log(`${clc.blueBright('[ipcMain.js]')} ${text}`);
};

const client = require('discord-rich-presence')('818936529484906596');

/**
 * Download the audio bytes using the headers required by bilivideo.
 *
 * @param {string} url The URL to fetch.
 * @returns {Promise<ArrayBuffer>} The audio bytes.
 */
async function getBiliVideoFile(url) {
  const axios = await import('axios').then(m => m.default);
  const response = await axios.get(url, {
    headers: {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': 'okhttp/3.4.1',
    },
    responseType: 'arraybuffer',
  });

  const bytes = response.data;
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

/**
 * Parse the source string (`a, b`) to source list `['a', 'b']`.
 *
 * @param {import("@unblockneteasemusic/rust-napi").Executor} executor
 * @param {string} sourceString The source string.
 * @returns {string[]} The source list.
 */
function parseSourceStringToList(executor, sourceString) {
  const availableSource = executor.list();

  return sourceString
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => {
      const isAvailable = availableSource.includes(s);

      if (!isAvailable) {
        log(`This source is not one of the supported source: ${s}`);
      }

      return isAvailable;
    });
}

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
  // WIP: Do not enable logging as it has some issues in non-blocking I/O environment.
  // UNM.enableLogging(UNM.LoggingType.ConsoleEnv);
  const unmExecutor = new UNM.Executor();

  ipcMain.handle(
    'unblock-music',
    /**
     *
     * @param {*} _
     * @param {string | null} sourceListString
     * @param {Record<string, any>} ncmTrack
     * @param {UNM.Context} context
     */
    async (_, sourceListString, ncmTrack, context) => {
      // Formt the track input
      // FIXME: Figure out the structure of Track
      const song = {
        id: ncmTrack.id && ncmTrack.id.toString(),
        name: ncmTrack.name,
        duration: ncmTrack.dt,
        album: ncmTrack.al && {
          id: ncmTrack.al.id && ncmTrack.al.id.toString(),
          name: ncmTrack.al.name,
        },
        artists: ncmTrack.ar
          ? ncmTrack.ar.map(({ id, name }) => ({
              id: id && id.toString(),
              name,
            }))
          : [],
      };

      const sourceList =
        typeof sourceListString === 'string'
          ? parseSourceStringToList(unmExecutor, sourceListString)
          : ['ytdl', 'bilibili', 'pyncm', 'kugou'];
      log(`[UNM] using source: ${sourceList.join(', ')}`);

      try {
        // TODO: tell users to install yt-dlp.
        const matchedAudio = await unmExecutor.search(
          sourceList,
          song,
          context
        );
        const retrievedSong = await unmExecutor.retrieve(matchedAudio, context);

        log(`respond with retrieve song…`);
        log(JSON.stringify(matchedAudio));
        const sourceInfo = {
          from: `unm:${retrievedSong.source}`,
          bitRate: 128000,
          cached: false,
        };
        return retrievedSong.url.includes('bilivideo.com')
          ? {
              kind: 'bytes',
              bytes: await getBiliVideoFile(retrievedSong.url),
              sourceInfo,
            }
          : { kind: 'url', url: retrievedSong.url, sourceInfo };
      } catch (err) {
        const errorMessage = err instanceof Error ? `${err.message}` : `${err}`;
        log(`UnblockNeteaseMusic failed: ${errorMessage}`);
        return null;
      }
    }
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
