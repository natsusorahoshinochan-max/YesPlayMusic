import { EventEmitter } from 'events';
import { createDbus } from '@/electron/mpris';
import dbus from 'dbus-next';
import { ipcMain } from 'electron';

jest.mock('dbus-next', () => ({
  sessionBus: jest.fn(),
  Variant: class Variant {},
}));
jest.mock('electron', () => ({
  ipcMain: new (require('events').EventEmitter)(),
}));

function setup(getProxyObject) {
  const bus = new EventEmitter();
  Object.assign(bus, { getProxyObject, disconnect: jest.fn() });
  dbus.sessionBus.mockReturnValue(bus);
  const win = new EventEmitter();
  win.webContents = { send: jest.fn(), isDestroyed: () => false };
  return { bus, win };
}
afterEach(() => {
  ipcMain.removeAllListeners();
  jest.useRealTimers();
});

test('failed OSD connection releases its bus and does not install a lyric consumer', async () => {
  const error = new Error('daemon unavailable');
  const { bus, win } = setup(async () => {
    throw error;
  });
  await expect(createDbus(win)).rejects.toBe(error);
  expect(bus.disconnect).toHaveBeenCalledTimes(1);
  expect(ipcMain.listenerCount('sendLyrics')).toBe(0);
});

test('lyric conversion failure acknowledges the renderer and window teardown releases publication', async () => {
  const write = jest.fn(async () => {});
  const { bus, win } = setup(async () => ({
    getInterface: () => ({ SetLyricContent: write }),
  }));
  await createDbus(win);
  const [publish] = ipcMain.listeners('sendLyrics');
  await publish(
    { sender: win.webContents },
    { track: { name: 'broken' }, lyrics: '', requestId: 4 }
  );
  expect(win.webContents.send).toHaveBeenCalledWith('saveLyricFinished', 4);
  win.emit('closed');
  expect(bus.disconnect).toHaveBeenCalledTimes(1);
  expect(ipcMain.listenerCount('sendLyrics')).toBe(0);
});

test('a missing connection reply terminates and releases the bus', async () => {
  jest.useFakeTimers();
  const { bus, win } = setup(() => new Promise(() => {}));
  const connection = createDbus(win);
  const result = expect(connection).rejects.toThrow('Timed out');
  jest.advanceTimersByTime(5000);
  await result;
  expect(bus.disconnect).toHaveBeenCalledTimes(1);
});

test('a missing write reply acknowledges after its bounded wait and releases the request timer', async () => {
  jest.useFakeTimers();
  const { win } = setup(async () => ({
    getInterface: () => ({
      SetLyricContent: () => new Promise(() => {}),
    }),
  }));
  await createDbus(win);
  const [publish] = ipcMain.listeners('sendLyrics');
  const operation = publish(
    { sender: win.webContents },
    {
      track: { name: 'track', ar: [] },
      lyrics: '[00:00]line',
      requestId: 8,
    }
  );
  jest.advanceTimersByTime(5000);
  await operation;
  expect(win.webContents.send).toHaveBeenCalledWith('saveLyricFinished', 8);
  expect(jest.getTimerCount()).toBe(0);
  win.emit('closed');
});

test('a rejected write and a destroyed acknowledgement receiver do not reject an IPC callback', async () => {
  const { win } = setup(async () => ({
    getInterface: () => ({
      SetLyricContent: async () => {
        throw new Error('write rejected');
      },
    }),
  }));
  win.webContents.send.mockImplementation(() => {
    throw new Error('renderer gone');
  });
  await createDbus(win);
  const [publish] = ipcMain.listeners('sendLyrics');
  await expect(
    publish(
      { sender: win.webContents },
      {
        track: { name: 'track', ar: [] },
        lyrics: '',
        requestId: 9,
      }
    )
  ).resolves.toBeUndefined();
  win.emit('closed');
});
