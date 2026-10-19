import dbus from 'dbus-next';
import { ipcMain } from 'electron';

export function createMpris(window, windowOperations) {
  const Player = require('mpris-service');
  const renderer = window.webContents;

  const player = Player({
    name: 'yesplaymusic',
    identity: 'YesPlayMusic',
  });

  player.on('next', () => renderer.send('next'));
  player.on('previous', () => renderer.send('previous'));
  player.on('playpause', () => renderer.send('toggle'));
  player.on('play', () => renderer.send('play'));
  player.on('pause', () => renderer.send('pause'));
  player.on('quit', () => windowOperations.quit());
  player.on('position', args =>
    renderer.send('setPosition', args.position / 1000 / 1000)
  );
  player.on('loopStatus', status => {
    const mode = {
      [Player.LOOP_STATUS_NONE]: 'off',
      [Player.LOOP_STATUS_TRACK]: 'one',
      [Player.LOOP_STATUS_PLAYLIST]: 'on',
    }[status];
    if (mode) renderer.send('setRepeatMode', mode);
  });
  player.on('shuffle', enabled => renderer.send('setShuffle', enabled));

  ipcMain.on('player', (e, { playing }) => {
    try {
      player.playbackStatus = playing
        ? Player.PLAYBACK_STATUS_PLAYING
        : Player.PLAYBACK_STATUS_PAUSED;
    } catch {
      // MPRIS clients may disconnect independently from the player.
    }
  });

  ipcMain.on('metadata', (e, metadata) => {
    // 更新 Mpris 状态前将位置设为0, 否则 OSDLyrics 获取到的进度是上首音乐切换时的进度
    player.getPosition = () => 0;
    try {
      player.metadata = {
        'mpris:trackid': player.objectPath('track/' + metadata.trackId),
        'mpris:artUrl': metadata.artwork[0].src,
        'mpris:length': metadata.length * 1000 * 1000,
        'xesam:title': metadata.title,
        'xesam:album': metadata.album,
        'xesam:artist': metadata.artist.split(','),
        'xesam:url': metadata.url,
      };
    } catch {
      // MPRIS clients may disconnect independently from the player.
    }
  });

  ipcMain.on('playerCurrentTrackTime', (e, position) => {
    player.getPosition = () => position * 1000 * 1000;
    try {
      player.seeked(position * 1000 * 1000);
    } catch {
      // MPRIS clients may disconnect independently from the player.
    }
  });

  ipcMain.on('seeked', (e, position) => {
    try {
      player.seeked(position * 1000 * 1000);
    } catch {
      // MPRIS clients may disconnect independently from the player.
    }
  });

  ipcMain.on('switchRepeatMode', (e, mode) => {
    try {
      switch (mode) {
        case 'off':
          player.loopStatus = Player.LOOP_STATUS_NONE;
          break;
        case 'one':
          player.loopStatus = Player.LOOP_STATUS_TRACK;
          break;
        case 'on':
          player.loopStatus = Player.LOOP_STATUS_PLAYLIST;
          break;
      }
    } catch {
      // MPRIS clients may disconnect independently from the player.
    }
  });

  ipcMain.on('switchShuffle', (e, shuffle) => {
    try {
      player.shuffle = shuffle;
    } catch {
      // MPRIS clients may disconnect independently from the player.
    }
  });
}

export async function createDbus(window) {
  const bus = dbus.sessionBus();
  const renderer = window.webContents;
  const pending = new Set();
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    ipcMain.removeListener('sendLyrics', publish);
    window.removeListener('closed', dispose);
    pending.forEach(stop => stop(new Error('OSD lyrics connection closed')));
    bus.disconnect();
  }
  function bounded(work) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        pending.delete(finish);
        if (error) reject(error);
        else resolve(result);
      };
      const timeout = setTimeout(
        () => finish(new Error('Timed out waiting for OSD lyrics')),
        5000
      );
      pending.add(finish);
      Promise.resolve()
        .then(() => {
          if (disposed || settled)
            throw new Error('OSD lyrics connection closed');
          return work();
        })
        .then(
          result => finish(null, result),
          error => finish(error)
        );
    });
  }
  bus.on('error', error => {
    console.debug('[OSD lyrics] connection failed', error);
    dispose();
  });
  window.once('closed', dispose);
  let osdInterface;
  async function publish(event, { track, lyrics, requestId }) {
    if (disposed || event.sender !== renderer) return;
    try {
      const metadata = {
        title: new dbus.Variant('s', track.name),
        artist: new dbus.Variant('s', track.ar.map(ar => ar.name).join(', ')),
      };
      await bounded(() =>
        osdInterface.SetLyricContent(metadata, Buffer.from(lyrics))
      );
    } catch (error) {
      console.debug('[OSD lyrics] write failed', error);
    } finally {
      if (!disposed && !renderer.isDestroyed()) {
        try {
          renderer.send('saveLyricFinished', requestId);
        } catch (error) {
          console.debug('[OSD lyrics] acknowledgement failed', error);
        }
      }
    }
  }
  try {
    const osdService = await bounded(() =>
      bus.getProxyObject('org.osdlyrics.Daemon', '/org/osdlyrics/Lyrics')
    );
    if (disposed) throw new Error('OSD lyrics connection closed');
    osdInterface = osdService.getInterface('org.osdlyrics.Lyrics');
    ipcMain.on('sendLyrics', publish);
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
