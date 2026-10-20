import { EventEmitter } from 'events';
import { ipcMain } from 'electron';
import Player from 'mpris-service';
import { createMpris } from '@/electron/mpris';
import { createPlaybackPlatform } from '@/application/playbackPlatform';

jest.mock('electron', () => ({
  ipcMain: new (require('events').EventEmitter)(),
}));
jest.mock('mpris-service', () => jest.fn());
jest.mock('dbus-next', () => ({}));

test('position samples update MPRIS position; one explicit seek emits one Seeked signal', () => {
  const native = new EventEmitter();
  native.seeked = jest.fn();
  Player.mockReturnValue(native);
  createMpris({ webContents: { send: jest.fn() } }, {});
  const renderer = new EventEmitter();
  renderer.send = (channel, value) => ipcMain.emit(channel, {}, value);
  const platform = createPlaybackPlatform({
    playback: {},
    ipc: renderer,
    navigator: {},
    createTouchBar: false,
    createTray: false,
    createMpris: true,
  });
  try {
    platform.progress(10);
    expect(native.getPosition()).toBe(10000000);
    expect(native.seeked).not.toHaveBeenCalled();
    platform.progress(42, { seeked: true });
    expect(native.getPosition()).toBe(42000000);
    expect(native.seeked.mock.calls).toEqual([[42000000]]);
  } finally {
    platform.dispose();
    ipcMain.removeAllListeners();
  }
});
