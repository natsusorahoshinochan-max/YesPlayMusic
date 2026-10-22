const { globalShortcut } = require('electron');

const clc = require('cli-color');
const log = text => {
  console.log(`${clc.blueBright('[globalShortcut.js]')} ${text}`);
};

export function registerGlobalShortcut(win, store) {
  log('registerGlobalShortcut');
  const shortcuts = store.get('settings.shortcuts');

  globalShortcut.register(
    shortcuts.find(s => s.id === 'play').globalShortcut,
    () => {
      win.webContents.send('toggle');
    }
  );
  globalShortcut.register(
    shortcuts.find(s => s.id === 'next').globalShortcut,
    () => {
      win.webContents.send('next');
    }
  );
  globalShortcut.register(
    shortcuts.find(s => s.id === 'previous').globalShortcut,
    () => {
      win.webContents.send('previous');
    }
  );
  globalShortcut.register(
    shortcuts.find(s => s.id === 'increaseVolume').globalShortcut,
    () => {
      win.webContents.send('increaseVolume');
    }
  );
  globalShortcut.register(
    shortcuts.find(s => s.id === 'decreaseVolume').globalShortcut,
    () => {
      win.webContents.send('decreaseVolume');
    }
  );
  globalShortcut.register(
    shortcuts.find(s => s.id === 'like').globalShortcut,
    () => {
      win.webContents.send('like');
    }
  );
  globalShortcut.register(
    shortcuts.find(s => s.id === 'minimize').globalShortcut,
    () => {
      win.isVisible() ? win.hide() : win.show();
    }
  );
}
