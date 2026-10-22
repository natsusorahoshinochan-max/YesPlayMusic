// Throwaway runner. All browser data belongs to the dedicated :8093 origin.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const root = path.resolve(__dirname, '..');
const bundledNode = path.join(
  root,
  '.direnv/runtime/node-v16.20.2-darwin-arm64/bin/node'
);
const node = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
if (process.execPath !== fs.realpathSync(node)) {
  const child = spawn(node, [__filename], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => child.kill(signal));
  child.on('exit', code => process.exit(code || 0));
} else {
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ypm-PROTOTYPE-wipe-me-')
  );
  const children = [];
  const start = (entry, args, env, log) => {
    const fd = fs.openSync(path.join(scratch, log), 'a');
    const child = spawn(node, [entry, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', fd, fd],
    });
    children.push(child);
    child.on('exit', code => console.log(`${log}: exited ${code}`));
  };

  // Observe the real native call, then execute it unchanged. No fake response.
  const UNM = require('@unblockneteasemusic/rust-napi');
  const { AsyncLocalStorage } = require('async_hooks');
  const observation = new AsyncLocalStorage();
  const search = UNM.Executor.prototype.search;
  UNM.Executor.prototype.search = function (sources, song, context) {
    const record = observation.getStore();
    if (record) record.request = { sources, song, context };
    return search.call(this, sources, song, context);
  };
  const unblockMusic = require('../src/electron/unblockMusic');
  const server = http
    .createServer(async (req, res) => {
      if (req.headers.origin !== 'http://127.0.0.1:8093') {
        res.statusCode = 403;
        return res.end();
      }
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8093');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') return res.end();
      if (
        req.method !== 'POST' ||
        req.url !== '/unm' ||
        req.headers['content-type'] !== 'application/json'
      ) {
        res.statusCode = 404;
        return res.end('{}');
      }
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { trackId, settings } = JSON.parse(body);
        const axios = require('axios');
        const { data } = await axios.get('http://127.0.0.1:3000/song/detail', {
          params: { ids: trackId },
        });
        const record = {};
        const resource = await observation.run(record, () =>
          unblockMusic(data.songs[0], settings)
        );
        record.result = resource && {
          kind: resource.kind,
          sourceInfo: resource.sourceInfo,
          byteLength: resource.bytes?.byteLength,
          hasUrl: Boolean(resource.url),
        };
        fs.appendFileSync(
          path.join(scratch, 'unm-observations.jsonl'),
          JSON.stringify(record) + '\n'
        );
        res.end(JSON.stringify(record));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error.message }));
      }
    })
    .listen(3093, '127.0.0.1', () => {
      start(
        require.resolve('@neteaseapireborn/api/app.js'),
        [],
        { HOST: '127.0.0.1', PORT: '3000' },
        'api.log'
      );
      start(
        require.resolve('@vue/cli-service/bin/vue-cli-service.js'),
        ['serve', '--host', '127.0.0.1', '--port', '8093'],
        {
          VUE_APP_NETEASE_API_URL: '/api',
          VUE_APP_COMPLEXITY_PROTOTYPE: 'true',
        },
        'web.log'
      );
      console.log(
        `PROTOTYPE: http://127.0.0.1:8093/album/1754736\nScratch logs: ${scratch}\nCtrl+C stops all three local services.`
      );
    });
  const stop = () => {
    children.forEach(child => child.kill());
    server.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
}
