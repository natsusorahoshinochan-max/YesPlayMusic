import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import { app, BrowserWindow, dialog, globalShortcut } from 'electron';
import { createWindowOperations } from '../../src/electron/windowOperations';
import { initIpcMain } from '../../src/electron/ipcMain';

const output = process.env.YPM_NATIVE_SMOKE_OUTPUT;
const evidence = {
  platform: process.platform,
  electron: process.versions.electron,
  assertions: [],
  lifecycle: [],
};
let win;
let option = 'ask';
let nativeClose;
let expectedQuit = false;
const record = assertion => {
  evidence.assertions.push(assertion);
  console.log(`PASS ${assertion}`);
};
const wait = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
const operations = createWindowOperations({
  app,
  dialog,
  platform: process.platform,
  getWindow: () => win,
  getCloseOption: () => option,
  rememberCloseOption: () => {
    throw new Error('Smoke does not automate checkbox persistence');
  },
  onError: error => {
    throw error;
  },
});
app.on('before-quit', () => evidence.lifecycle.push('before-quit'));
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  evidence.lifecycle.push('will-quit cleanup');
});
app.on('quit', () => {
  evidence.lifecycle.push('quit');
  assert(expectedQuit, 'Quit must occur only for the selected exit intent');
  assert(win.isDestroyed(), 'Normal quit destroys the native window');
  record('normal quit destroys BrowserWindow and reaches will-quit cleanup');
  fs.writeFileSync(
    path.join(output, 'native-evidence.json'),
    JSON.stringify(evidence, null, 2)
  );
});

function pressDialogKey(key) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const done = error => (error ? reject(error) : resolve());
      if (process.platform === 'linux')
        execFile(
          'xdotool',
          ['key', key === 'cancel' ? 'Escape' : 'Return'],
          done
        );
      else
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${
              key === 'cancel' ? '{ESC}' : '{ENTER}'
            }')`,
          ],
          done
        );
    }, 1000);
  });
}

app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      width: 800,
      height: 500,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    win.on('close', event => {
      nativeClose = operations.close(event);
    });
    initIpcMain(win, { get: () => option }, new EventEmitter(), operations);
    await win.loadURL(
      'data:text/html,<h1>YesPlayMusic native window close acceptance</h1>'
    );
    const titlebarClose = async () => {
      await win.webContents.executeJavaScript(
        "require('electron').ipcRenderer.send('close')"
      );
      await wait(150);
    };
    if (process.platform !== 'darwin') {
      win.show();
      win.focus();
      const cancel = pressDialogKey('cancel');
      win.close();
      await cancel;
      await nativeClose;
      assert(win.isVisible() && !win.isDestroyed());
      record(
        'native close opens real platform dialog; Escape cancels and preserves usable window'
      );
      const chooseTray = pressDialogKey('tray');
      await titlebarClose();
      await chooseTray;
      for (let attempt = 0; win.isVisible() && attempt < 50; attempt++)
        await wait(100);
      assert(!win.isVisible() && !win.isDestroyed());
      record(
        'titlebar IPC can retry real dialog after cancellation; default selection hides live window'
      );
    }
    option = 'minimizeToTray';
    win.show();
    win.close();
    assert(!win.isVisible() && !win.isDestroyed());
    record('native close hides live BrowserWindow under actual OS policy');
    win.show();
    await titlebarClose();
    assert(!win.isVisible() && !win.isDestroyed());
    record('real renderer titlebar IPC hides same live BrowserWindow');
    win.show();
    assert(win.isVisible());
    record('hidden window can be shown again');
    expectedQuit = true;
    if (process.platform === 'darwin') operations.quit();
    else {
      option = 'exit';
      await titlebarClose();
    }
  })
  .catch(error => {
    fs.writeFileSync(
      path.join(output, 'failure.txt'),
      error.stack || String(error)
    );
    console.error(error);
    app.exit(1);
  });
setTimeout(() => {
  fs.writeFileSync(
    path.join(output, 'failure.txt'),
    'Native smoke exceeded 30 seconds'
  );
  app.exit(2);
}, 30000).unref();
