// Throwaway manual migration demo. Run: node src/store/unm-settings.prototype.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildSync } = require('esbuild');
const Vue = require('vue');
const Vuex = require('vuex');

const root = path.resolve(__dirname, '../..');
const baseline = '7c70e85';
const scratch = fs.mkdtempSync('/tmp/ypm-PROTOTYPE-wipe-me-unm-');
const archive = path.join(scratch, 'local-storage.json');
fs.symlinkSync(
  path.join(root, 'node_modules'),
  path.join(scratch, 'node_modules')
);
fs.writeFileSync(archive, '{}');
const storage = {
  getItem(key) {
    return JSON.parse(fs.readFileSync(archive, 'utf8'))[key] ?? null;
  },
  setItem(key, value) {
    const entries = JSON.parse(fs.readFileSync(archive, 'utf8'));
    entries[key] = value;
    fs.writeFileSync(archive, JSON.stringify(entries, null, 2));
  },
};
const fields = [
  'unmSource',
  'unmProxyUri',
  'unmJooxCookie',
  'unmQQCookie',
  'unmYtDlExe',
];
const inspect = settings =>
  Object.fromEntries(
    fields.map(key => [
      key,
      { value: settings[key], type: typeof settings[key] },
    ])
  );
function load(file, revision) {
  const contents = revision
    ? execFileSync('git', ['show', `${revision}:${file}`], {
        cwd: root,
        encoding: 'utf8',
      })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const outfile = path.join(
    scratch,
    `${revision || 'current'}-${path.basename(file)}.cjs`
  );
  buildSync({
    stdin: { contents, resolveDir: path.dirname(path.join(root, file)) },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    alias: { '@': path.join(root, 'src') },
  });
  return require(outfile);
}

async function run() {
  Vue.use(Vuex);
  const oldPersistence = load(
    'src/store/persistence.js',
    baseline
  ).createPersistence(storage);
  const oldPreferences = load(
    'src/store/modules/preferences.js',
    baseline
  ).default;
  let store;
  store = new Vuex.Store({
    plugins: [oldPersistence.install],
    modules: {
      session: { state: oldPersistence.snapshot.session },
      library: { state: oldPersistence.snapshot.library },
      preferences: oldPreferences(oldPersistence.snapshot.preferences, {
        persist: () => oldPersistence.save(store.state),
      }),
    },
  });
  await oldPersistence.ready;
  for (const key of fields)
    await store.dispatch('preferences/setPreference', { key, value: '' });
  const historical = inspect(JSON.parse(storage.getItem('settings')));

  const restored = load('src/store/persistence.js').createPersistence(storage);
  const runtime = inspect(restored.snapshot.preferences.settings);
  await restored.save(restored.snapshot);
  const persisted = inspect(JSON.parse(storage.getItem('settings')));
  console.log(
    JSON.stringify(
      { baseline, archive, historical, runtime, persisted },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
