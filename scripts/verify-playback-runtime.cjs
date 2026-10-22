#!/usr/bin/env node
/* Native Electron actual-app acceptance. No DOM, webpack, CDP or audio mocks. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {
  seedPlaybackRuntimeFixture,
} = require('./playback-runtime-fixture.cjs');
const root = path.resolve(
  process.env.YPM_RUNTIME_ROOT || path.join(__dirname, '..')
);
const output = path.resolve(
  process.env.YPM_RUNTIME_RESULT ||
    '/tmp/yesplaymusic-spec17-context/runtime25-result.json'
);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function launch() {
  const main = path.resolve(
    process.env.YPM_ELECTRON_MAIN ||
      path.join(root, 'dist_electron/bundled/background.js')
  );
  assert(
    fs.existsSync(main),
    `Build the production Electron app first: missing ${main}`
  );
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ypm-spec17-electron-')
  );
  const binary =
    process.env.YPM_ELECTRON_BINARY ||
    require(path.join(root, 'node_modules/electron'));
  const launchedAt = Date.now();
  const child = require('child_process').spawn(binary, [__filename], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      IS_TEST: '1',
      YPM_ELECTRON_MAIN: main,
      YPM_RUNTIME_PROFILE: profile,
      YPM_RUNTIME_RESULT: output,
    },
  });
  child.once('error', error => {
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  });
  child.once('exit', (code, signal) => {
    fs.rmSync(profile, { recursive: true, force: true });
    console.log(
      `Runtime report: ${output}; exit=${code}; signal=${signal || 'none'}`
    );
    let successfulReport = false;
    try {
      const result = JSON.parse(fs.readFileSync(output, 'utf8'));
      successfulReport =
        result.status === 'passed' && Date.parse(result.started) >= launchedAt;
    } catch {}
    process.exitCode = code === 0 && successfulReport ? 0 : 1;
  });
}

async function nativeMain() {
  const { app, session } = require('electron');
  assert(
    typeof app.setPath === 'function',
    'This harness requires native Electron'
  );
  assert(
    process.env.YPM_RUNTIME_PROFILE,
    'Launch with Node to create an isolated profile'
  );
  app.setPath('userData', process.env.YPM_RUNTIME_PROFILE);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  const report = {
    status: 'running',
    main: process.env.YPM_ELECTRON_MAIN,
    started: new Date().toISOString(),
    electron: process.versions.electron,
    checks: [],
    channels: {},
    resources: [],
    sinkCalls: [],
    fixtureRequests: [],
    boundaries: [
      'No public actual-app dispose control; native application shutdown releases the renderer. Idempotent Playback.dispose requires the public API integration suite.',
      'macOS does not exercise Linux MPRIS; native UI visual acceptance is separate.',
    ],
  };
  const check = (name, detail) => report.checks.push({ name, detail });
  let finished = false;
  let fixtureServer;
  const finish = error => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    report.status = error ? 'failed' : 'passed';
    if (error) report.error = String(error.stack || error);
    report.finished = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    fixtureServer?.close();
    app.quit();
    setTimeout(() => app.exit(error ? 1 : 0), 1000).unref();
  };
  const deadline = setTimeout(
    () => finish(new Error('Native runtime exceeded 60 second deadline')),
    60000
  );
  const preload = path.join(
    process.env.YPM_RUNTIME_PROFILE,
    'runtime-observers.cjs'
  );
  fs.writeFileSync(
    preload,
    `const { ipcRenderer } = require('electron');
    const emit = (kind, detail) => ipcRenderer.send('ypm-runtime-observe', { kind, detail });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); emit('create', url); return url; };
    URL.revokeObjectURL = url => { emit('revoke', url); return revoke(url); };
    const original = HTMLMediaElement.prototype.setSinkId;
    emit('sink-capability', typeof original === 'function');
    if (original) HTMLMediaElement.prototype.setSinkId = function(id) {
      emit('sink-call', id); return original.call(this, id).then(value => { emit('sink-resolved', id); return value; }, error => { emit('sink-rejected', error.name); throw error; });
    };
  `
  );
  app.once('ready', () => {
    session.defaultSession.setPreloads([preload]);
    fixtureServer = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://fixture');
      const ids = (url.searchParams.get('ids') || '').split(',').map(Number);
      const songs = ids.map((id, index) => ({
        id,
        name: `Runtime tone ${id - 900000000}`,
        ar: [{ id: 900000010, name: 'Runtime fixture' }],
        al: { id: 900000020, name: 'Local WAV', picUrl: '' },
        no: index + 1,
        dt: 12000,
        fee: 0,
        st: 0,
      }));
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      response.end(
        JSON.stringify({
          code: 200,
          songs,
          privileges: ids.map(id => ({ id, st: 0, fee: 0, pl: 128000 })),
        })
      );
    });
    fixtureServer.listen(0, '127.0.0.1');
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const ids = url.searchParams.get('ids');
      if (
        url.pathname.endsWith('/song/detail') &&
        ids &&
        ids.split(',').every(id => ['900000001', '900000002'].includes(id)) &&
        url.port !== String(fixtureServer.address()?.port)
      ) {
        report.fixtureRequests.push({ path: url.pathname, ids });
        callback({
          redirectURL: `http://127.0.0.1:${
            fixtureServer.address().port
          }/song/detail?ids=${encodeURIComponent(ids)}`,
        });
      } else callback({});
    });
  });
  let handling = false;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('ipc-message', (_event, channel, payload) => {
      if (channel === 'ypm-runtime-observe') {
        if (payload.kind.startsWith('sink')) report.sinkCalls.push(payload);
        else report.resources.push(payload);
      } else if (
        [
          'player',
          'playerCurrentTrackTime',
          'updateTrayPlayState',
          'updateTrayTooltip',
          'metadata',
          'switchRepeatMode',
          'switchShuffle',
        ].includes(channel)
      ) {
        report.channels[channel] = (report.channels[channel] || 0) + 1;
      }
    });
    contents.on('render-process-gone', (_event, details) =>
      finish(new Error(`Renderer exited: ${details.reason}`))
    );
    contents.once('did-finish-load', async () => {
      if (handling) return;
      handling = true;
      const execute = code => contents.executeJavaScript(code, true);
      const snapshot = () =>
        execute('window.yesplaymusic && window.yesplaymusic.player');
      const until = async (name, predicate, timeout = 8000) => {
        const end = Date.now() + timeout;
        let state;
        while (Date.now() < end) {
          state = await snapshot();
          if (state && predicate(state)) return state;
          await delay(100);
        }
        throw new Error(`${name}: ${JSON.stringify(state)}`);
      };
      try {
        await until('Initial public app snapshot', () => true);
        assert(
          (await execute('typeof window.yesplaymusic.player.play')) ===
            'undefined',
          'Global export must remain snapshot-only'
        );
        report.fixture = await execute(
          `(${seedPlaybackRuntimeFixture.toString()})()`
        );
        await new Promise(resolve => {
          contents.once('did-finish-load', resolve);
          contents.reload();
        });
        let state = await until(
          'Cached archive restoration',
          value =>
            value.currentTrack.id === 900000001 &&
            value.sourceInfo &&
            !value.loading
        );
        assert(
          !state.playing && state.volume === 0.3,
          'Restore must be paused and preserve volume'
        );
        check(
          'Actual application restores cached metadata/WAV through production assembly',
          { track: state.currentTrack.id, source: state.sourceInfo }
        );
        contents.send('play');
        state = await until('Actual Howler play event', value => value.playing);
        const start = state.progress;
        await until(
          'Decoded WAV audio clock advances',
          value => value.progress > start + 0.25
        );
        check('Real decoded audio clock advances');
        contents.send('play');
        state = await until('Native pause', value => !value.playing);
        // Public progress is sampled every 1000ms. Allow one complete
        // interval to capture the final paused position before taking a baseline.
        await delay(1100);
        const paused = (await snapshot()).progress;
        await delay(1100);
        state = await snapshot();
        assert(
          Math.abs(state.progress - paused) < 0.15,
          'Paused audio clock must remain stable'
        );
        check(
          'Paused clock stays stable across a subsequent sampling interval',
          {
            baseline: paused,
            observed: state.progress,
            intervalMs: 1100,
            toleranceSeconds: 0.15,
          }
        );
        contents.send('setPosition', 1.5);
        await until(
          'Native seek',
          value => Math.abs(value.progress - 1.5) < 0.15
        );
        contents.send('play');
        await until(
          'Native resume',
          value => value.playing && value.progress > 1.7
        );
        check('Native IPC pause/resume/seek operate on shared Playback');
        contents.send('increaseVolume');
        await until(
          'Native volume',
          value => Math.abs(value.volume - 0.4) < 0.001
        );
        contents.send('repeat');
        await until('Native repeat', value => value.repeatMode === 'on');
        contents.send('shuffle');
        await until('Native shuffle', value => value.shuffle === true);
        check('Native volume/repeat/shuffle update public state');
        const firstURLs = report.resources
          .filter(event => event.kind === 'create')
          .map(event => event.detail);
        assert(
          firstURLs.length > 0,
          'Actual cache hit must create an owned Blob URL'
        );
        contents.send('next');
        state = await until(
          'Native next',
          value =>
            value.currentTrack.id === 900000002 &&
            value.playing &&
            value.sourceInfo
        );
        assert(
          report.resources.some(
            event => event.kind === 'revoke' && firstURLs.includes(event.detail)
          ),
          'Handoff must revoke the previous owned Blob URL'
        );
        check(
          'Native next hands off decoded audio and revokes previous Blob URL'
        );
        contents.send('previous');
        await until(
          'Native previous',
          value => value.currentTrack.id === 900000001 && value.playing
        );
        check('Native previous returns to first cached track');
        const endpoint = await new Promise((resolve, reject) => {
          http
            .get('http://127.0.0.1:27232/player', response => {
              let data = '';
              response.on('data', chunk => {
                data += chunk;
              });
              response.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (error) {
                  reject(error);
                }
              });
            })
            .on('error', reject);
        });
        assert(
          endpoint.currentTrack?.id === 900000001 &&
            typeof endpoint.progress === 'number',
          'Actual /player endpoint must expose live shared projection'
        );
        check(
          'Production /player endpoint and desktop state projection',
          endpoint
        );
        assert(
          report.channels.player > 0,
          'Actual desktop state IPC must be published'
        );
        report.trayProjection = report.channels.updateTrayPlayState
          ? 'observed'
          : 'not-enabled-on-this-platform-build';
        assert(
          report.sinkCalls.some(
            event =>
              event.kind === 'sink-resolved' && event.detail === 'default'
          ),
          'Real default setSinkId must resolve; missing capability is an acceptance failure'
        );
        check(
          'Real HTMLMediaElement.setSinkId(default) delegates to native implementation'
        );
        contents.send('play');
        await until('Final pause', value => !value.playing);
        report.finalState = await snapshot();
        finish();
      } catch (error) {
        finish(error);
      }
    });
  });
  require(process.env.YPM_ELECTRON_MAIN);
}
if (process.versions.electron)
  nativeMain().catch(error => {
    console.error(error);
    process.exit(1);
  });
else
  launch().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
