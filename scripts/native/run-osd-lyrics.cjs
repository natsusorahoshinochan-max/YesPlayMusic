const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../..');
const output = path.resolve(
  process.argv[2] || path.join(root, 'native-smoke-output')
);
fs.mkdirSync(output, { recursive: true });
const metadata = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  electron: require('electron/package.json').version,
};
fs.writeFileSync(
  path.join(output, 'revision.json'),
  JSON.stringify(metadata, null, 2)
);
// Keep the executable bundle beside node_modules so native external packages
// resolve exactly as they do from the application checkout.
const bundle = path.join(root, '.native-osd-lyrics.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'osd-lyrics.js')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  target: 'node14',
  packages: 'external',
  alias: { '@': path.join(root, 'src') },
});
const rendererBundle = path.join(root, '.native-osd-renderer.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'osd-lyrics-renderer.js')],
  outfile: rendererBundle,
  bundle: true,
  platform: 'node',
  format: 'iife',
  target: 'node14',
  external: ['electron'],
  alias: { '@': path.join(root, 'src') },
});
const environment = { ...process.env, YPM_NATIVE_SMOKE_OUTPUT: output };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [bundle], {
  cwd: root,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = fs.createWriteStream(path.join(output, 'electron.log'));
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on('data', chunk => {
  process.stderr.write(chunk);
  log.write(chunk);
});
const timeout = setTimeout(() => child.kill(), 60000);
child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  clearTimeout(timeout);
  log.end();
  fs.rmSync(bundle, { force: true });
  fs.rmSync(rendererBundle, { force: true });
  process.exitCode = code === 0 && !signal ? 0 : 1;
});
