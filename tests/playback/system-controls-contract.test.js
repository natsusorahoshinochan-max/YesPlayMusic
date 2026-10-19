import { EventEmitter } from 'events';
import { createPlayback } from '@/playback';
import { createPlaybackPlatform } from '@/application/playbackPlatform';
import { createMpris } from '@/electron/mpris';
import Player from 'mpris-service';
import { ipcMain } from 'electron';

jest.mock('electron', () => ({
  ipcMain: new (require('events').EventEmitter)(),
  app: {},
}));
jest.mock('dbus-next', () => ({}));
jest.mock('mpris-service', () => {
  const factory = jest.fn(() => {
    const player = new (require('events').EventEmitter)();
    player.objectPath = value => `/org/mpris/MediaPlayer2/${value}`;
    player.seeked = () => {};
    return player;
  });
  Object.assign(factory, {
    PLAYBACK_STATUS_PLAYING: 'Playing',
    PLAYBACK_STATUS_PAUSED: 'Paused',
    LOOP_STATUS_NONE: 'None',
    LOOP_STATUS_TRACK: 'Track',
    LOOP_STATUS_PLAYLIST: 'Playlist',
  });
  return factory;
});

function setup() {
  ipcMain.removeAllListeners();
  const ipc = new EventEmitter();
  ipc.send = (channel, value) => ipcMain.emit(channel, {}, value);
  const actions = {};
  let platform;
  const playback = createPlayback({
    getTrack: async id => ({
      id,
      name: `Track ${id}`,
      dt: 90000,
      ar: [{ name: 'Artist' }],
      al: { name: 'Album' },
    }),
    resources: {
      resolve: async () => ({ kind: 'url', url: '/audio', sourceInfo: {} }),
    },
    audio: {
      prepare: async (_, events) => ({
        play: events.onPlay,
        pause: events.onPause,
        position: () => 0,
        setVolume() {},
        dispose() {},
      }),
    },
    onStateChange: state => platform?.publish(state),
    setInterval: () => 0,
    clearInterval() {},
  });
  platform = createPlaybackPlatform({
    playback,
    ipc,
    navigator: {
      mediaSession: {
        setActionHandler: (name, action) => {
          actions[name] = action;
        },
      },
    },
    window,
    document,
    createMpris: true,
    createTray: false,
  });
  createMpris(
    { webContents: { send: (channel, value) => ipc.emit(channel, {}, value) } },
    {}
  );
  return {
    playback,
    platform,
    ipc,
    actions,
    player: Player.mock.results.at(-1).value,
  };
}

afterEach(() => ipcMain.removeAllListeners());

test('MPRIS Play and Pause preserve repeated target intents and PlayPause toggles', async () => {
  const f = setup();
  await f.playback.playTracks([1, 2]);
  f.player.emit('pause');
  f.player.emit('pause');
  expect(f.playback.state.playing).toBe(false);
  expect(f.player.playbackStatus).toBe('Paused');
  f.player.emit('play');
  f.player.emit('play');
  expect(f.playback.state.playing).toBe(true);
  expect(f.player.playbackStatus).toBe('Playing');
  f.player.emit('playpause');
  expect(f.playback.state.playing).toBe(false);
  f.player.emit('playpause');
  expect(f.playback.state.playing).toBe(true);
  f.platform.dispose();
  f.playback.dispose();
});

test('MPRIS loop and shuffle targets remain stable and publish matching platform state', async () => {
  const f = setup();
  await f.playback.playTracks([1, 2, 3]);
  for (const [target, expected] of [
    ['Track', 'one'],
    ['Playlist', 'on'],
    ['None', 'off'],
  ]) {
    f.player.emit('loopStatus', target);
    expect(f.playback.state.repeatMode).toBe(expected);
    f.player.emit('loopStatus', target);
    expect(f.playback.state.repeatMode).toBe(expected);
    expect(f.player.loopStatus).toBe(target);
  }
  f.player.emit('shuffle', true);
  const upcoming = f.playback.upcoming(3);
  f.player.emit('shuffle', true);
  expect(f.playback.state.shuffle).toBe(true);
  expect(f.playback.upcoming(3)).toEqual(upcoming);
  expect(f.player.shuffle).toBe(true);
  f.player.emit('shuffle', false);
  f.player.emit('shuffle', false);
  expect(f.playback.state.shuffle).toBe(false);
  expect(f.player.shuffle).toBe(false);
  f.platform.dispose();
  f.playback.dispose();
});

test('ordinary IPC controls, Web Media Session, and media keys retain their intents', async () => {
  const f = setup();
  await f.playback.playTracks([1, 2]);
  f.ipc.emit('toggle');
  expect(f.playback.state.playing).toBe(false);
  f.ipc.emit('toggle');
  expect(f.playback.state.playing).toBe(true);
  f.actions.pause();
  f.actions.pause();
  expect(f.playback.state.playing).toBe(false);
  f.actions.play();
  f.actions.play();
  expect(f.playback.state.playing).toBe(true);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'MediaPlayPause' })
  );
  expect(f.playback.state.playing).toBe(false);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'MediaPlayPause' })
  );
  expect(f.playback.state.playing).toBe(true);
  f.ipc.emit('repeat');
  expect(f.playback.state.repeatMode).toBe('on');
  f.ipc.emit('repeat');
  expect(f.playback.state.repeatMode).toBe('one');
  f.ipc.emit('shuffle');
  expect(f.playback.state.shuffle).toBe(true);
  f.ipc.emit('shuffle');
  expect(f.playback.state.shuffle).toBe(false);
  f.platform.dispose();
  f.player.emit('pause');
  expect(f.playback.state.playing).toBe(true);
  f.playback.dispose();
});
