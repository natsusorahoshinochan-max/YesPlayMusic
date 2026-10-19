import assert from 'assert';
import fs from 'fs';
import path from 'path';
import dbus from 'dbus-next';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createDbus, createMpris } from '../../src/electron/mpris';

const output = process.env.YPM_NATIVE_SMOKE_OUTPUT;
const evidence = {
  platform: process.platform,
  electron: process.versions.electron,
  assertions: [],
  events: [],
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = message => {
  evidence.assertions.push(message);
  console.log(`PASS ${message}`);
};
const event = (type, detail) =>
  evidence.events.push({ type, detail, at: Date.now() });
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(String(error)));
let mode = 'success';
let service;
let observer;
let dbusInterface;
const { Interface } = dbus.interface;
class Lyrics extends Interface {
  constructor() {
    super('org.osdlyrics.Lyrics');
  }
  async SetLyricContent(metadata, bytes) {
    event('raw-write', {
      mode,
      title: metadata.title.value,
      artist: metadata.artist.value,
      raw: Buffer.from(bytes).toString(),
    });
    if (mode === 'reject')
      throw new dbus.DBusError(
        'org.osdlyrics.Error',
        'Controlled native rejection'
      );
    if (mode === 'no-reply') return new Promise(() => {});
  }
}
Lyrics.configureMembers({
  methods: { SetLyricContent: { inSignature: 'a{sv}ay', outSignature: '' } },
});
async function until(predicate, label, timeout = 8000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error(`Timeout: ${label}`);
    await wait(30);
  }
}
async function names() {
  return new Set(await dbusInterface.ListNames());
}
async function nativeWindow() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.webContents.on('console-message', (_, level, message) => {
    console.log(`[renderer ${level}] ${message}`);
  });
  await win.loadURL(
    'data:text/html,<h1>Native Linux OSD publication acceptance</h1>'
  );
  await win.webContents.executeJavaScript(
    fs.readFileSync(
      path.join(app.getAppPath(), '.native-osd-renderer.cjs'),
      'utf8'
    )
  );
  return win;
}
async function ensureReleased(baseline, label) {
  await until(async () => {
    const current = await names();
    return [...current].every(name => baseline.has(name));
  }, label);
  assert.strictEqual(ipcMain.listenerCount('sendLyrics'), 0);
  record(label);
}
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    assert.strictEqual(process.platform, 'linux');
    assert(
      process.env.DBUS_SESSION_BUS_ADDRESS,
      'A real session daemon address is required'
    );
    observer = dbus.sessionBus();
    dbusInterface = (
      await observer.getProxyObject(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus'
      )
    ).getInterface('org.freedesktop.DBus');
    service = dbus.sessionBus();
    service.export('/org/osdlyrics/Lyrics', new Lyrics());
    await service.requestName('org.osdlyrics.Daemon', 0);
    await names();
    ipcMain.on('nativeAckObserved', (e, requestId) =>
      event('renderer-tagged-ack', requestId)
    );
    ipcMain.on('metadata', (e, metadata) =>
      event('metadata', metadata.trackId)
    );

    for (const [scenario, id] of [
      ['success', 101],
      ['reject', 102],
      ['no-reply', 103],
    ]) {
      mode = scenario;
      const win = await nativeWindow();
      const baseline = await names();
      const dispose = await createDbus(win);
      const offset = evidence.events.length;
      const started = Date.now();
      await win.webContents.executeJavaScript(
        `try { window.startNativePublication(${id}); null } catch (error) { console.error(error.stack); throw error }`
      );
      await until(
        () =>
          evidence.events
            .slice(offset)
            .some(item => item.type === 'metadata' && item.detail === id),
        `${scenario} metadata`
      );
      // Native and renderer timeouts share 5s; allow the native ack to arrive after renderer fallback.
      await until(
        () =>
          evidence.events
            .slice(offset)
            .some(item => item.type === 'renderer-tagged-ack'),
        `${scenario} tagged ack`
      );
      const observations = evidence.events.slice(offset);
      const write = observations.find(item => item.type === 'raw-write');
      assert.strictEqual(write.detail.raw, '[00:00.00]native lyrics');
      assert.strictEqual(write.detail.artist, 'native-artist');
      const ack = observations.find(
        item => item.type === 'renderer-tagged-ack'
      );
      assert.strictEqual(typeof ack.detail, 'number');
      if (scenario !== 'no-reply')
        assert.deepStrictEqual(
          observations.map(item => item.type),
          ['raw-write', 'renderer-tagged-ack', 'metadata']
        );
      else assert(Date.now() - started >= 4900 && Date.now() - started < 7500);
      assert.strictEqual(
        observations.filter(item => item.type === 'metadata').length,
        1
      );
      record(
        `${scenario}: real renderer platform → session D-Bus raw write → correlated acknowledgement → one metadata publication (${
          Date.now() - started
        }ms)`
      );
      win.close();
      assert(win.isDestroyed());
      await ensureReleased(
        baseline,
        `${scenario}: window.close removes lyrics IPC and releases session bus connection`
      );
      dispose();
    }

    mode = 'no-reply';
    const win = await nativeWindow();
    const baseline = await names();
    await createDbus(win);
    const offset = evidence.events.length;
    await win.webContents.executeJavaScript(
      'try { window.startNativePublication(104) } catch (error) { console.error(error.stack); throw error }'
    );
    await until(
      () =>
        evidence.events.slice(offset).some(item => item.type === 'raw-write'),
      'pending native write'
    );
    win.close();
    await ensureReleased(
      baseline,
      'window.close cancels pending no-reply write and releases IPC plus bus'
    );
    await wait(5200);
    assert.deepStrictEqual(
      evidence.events.slice(offset).map(item => item.type),
      ['raw-write']
    );
    record(
      'closed renderer receives no late acknowledgement or metadata after pending write timeout'
    );

    // A controlled service accepts Introspect without replying, exercising native setup timeout.
    const intercept = message =>
      mode === 'setup-no-reply' && message.member === 'Introspect';
    service.addMethodHandler(intercept);
    mode = 'setup-no-reply';
    const setupBaseline = await names();
    const setupWindow = await nativeWindow();
    const started = Date.now();
    await assert.rejects(createDbus(setupWindow), /Timed out waiting/);
    assert(Date.now() - started >= 4900 && Date.now() - started < 7500);
    await ensureReleased(
      setupBaseline,
      'no-reply service introspection terminates after 5s and releases bus plus IPC'
    );
    setupWindow.close();
    service.removeMethodHandler(intercept);
    await service.releaseName('org.osdlyrics.Daemon');

    const absentBaseline = await names();
    const absentWindow = await nativeWindow();
    await assert.rejects(createDbus(absentWindow));
    await ensureReleased(
      absentBaseline,
      'absent OSD service rejects setup and releases bus plus IPC'
    );
    createMpris(absentWindow, { quit: () => app.quit() });
    await until(
      async () => (await names()).has('org.mpris.MediaPlayer2.yesplaymusic'),
      'MPRIS initializes without OSD'
    );
    const mpris = await observer.getProxyObject(
      'org.mpris.MediaPlayer2.yesplaymusic',
      '/org/mpris/MediaPlayer2'
    );
    const props = mpris.getInterface('org.freedesktop.DBus.Properties');
    assert.strictEqual(
      (await props.Get('org.mpris.MediaPlayer2', 'Identity')).value,
      'YesPlayMusic'
    );
    record(
      'actual mpris-service exports readable YesPlayMusic identity despite absent OSD daemon'
    );
    absentWindow.close();
    await wait(100);
    assert.deepStrictEqual(unhandled, []);
    record(
      'all native setup/write/close exits complete with no unhandled promise rejection'
    );
    fs.writeFileSync(
      path.join(output, 'native-evidence.json'),
      JSON.stringify(evidence, null, 2)
    );
    service.disconnect();
    observer.disconnect();
    app.exit(0);
  })
  .catch(error => {
    fs.writeFileSync(
      path.join(output, 'failure.txt'),
      error.stack || String(error)
    );
    fs.writeFileSync(
      path.join(output, 'native-evidence.json'),
      JSON.stringify(evidence, null, 2)
    );
    console.error(error);
    app.exit(1);
  });
setTimeout(() => {
  console.error('Native OSD smoke exceeded 45s');
  app.exit(2);
}, 45000).unref();
