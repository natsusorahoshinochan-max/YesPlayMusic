import dbus from 'dbus-next';
import { ipcMain, app } from 'electron';

export function createMpris(window) {
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
  player.on('quit', () => app.exit());
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
  const Variant = dbus.Variant;

  const osdService = await bus.getProxyObject(
    'org.osdlyrics.Daemon',
    '/org/osdlyrics/Lyrics'
  );

  const osdInterface = osdService.getInterface('org.osdlyrics.Lyrics');

  ipcMain.on('sendLyrics', async (e, { track, lyrics, requestId }) => {
    const metadata = {
      title: new Variant('s', track.name),
      artist: new Variant('s', track.ar.map(ar => ar.name).join(', ')),
    };

    try {
      await osdInterface.SetLyricContent(metadata, Buffer.from(lyrics));
    } catch (error) {
      console.debug('[OSD lyrics] write failed', error);
    } finally {
      window.webContents.send('saveLyricFinished', requestId);
    }
  });
}
