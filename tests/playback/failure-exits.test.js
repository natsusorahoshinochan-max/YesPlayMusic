import 'fake-indexeddb/auto';
import http from 'http';
import { createPlayer } from '@/application/player';
import { createStore } from '@/store';
import { configureMusicData } from '@/application/musicData';
import { getTrackCache } from '@/utils/db';
import { configureRequest } from '@/utils/request';
import { createPlaybackReporting } from '@/application/playbackReporting';
import { scrobble, getMP3 } from '@/api/track';
import { createAudioResources } from '@/playback/audioResources';
import { EventEmitter } from 'events';
import { createPlaybackPlatform } from '@/application/playbackPlatform';

const track = id => ({
  id,
  name: `Track ${id}`,
  dt: 100000,
  ar: [{ name: 'Artist' }],
  al: { name: 'Album' },
  fee: 0,
});
let server;
let baseURL;
let failure;
let requests;
let player;
let handles;
let feedback;
let fmTracks;
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    requests.push(path);
    res.setHeader('Connection', 'close');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (path === failure) {
      res.writeHead(503);
      res.end('{"code":503}');
      return;
    }
    const data =
      path === '/song/detail'
        ? {
            songs: [
              track(Number(new URL(req.url, baseURL).searchParams.get('ids'))),
            ],
            privileges: [],
          }
        : path === '/song/url'
        ? { data: [{ url: 'https://audio.test/song', freeTrialInfo: null }] }
        : path === '/playlist/detail'
        ? { playlist: { trackIds: [{ id: 2 }] } }
        : path === '/personal_fm'
        ? { data: fmTracks }
        : path === '/lyric'
        ? { lrc: { lyric: '' } }
        : { code: 200 };
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(async () => {
  failure = undefined;
  requests = [];
  handles = [];
  feedback = [];
  fmTracks = [track(6), track(7)];
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL, configure: config => config },
  });
  const store = createStore({ storage, language: 'en' });
  const getSettings = () => ({
    musicQuality: 128000,
    automaticallyCacheSongs: false,
  });
  const getIdentity = () => ({ hasAccount: true, vipType: 0 });
  configureMusicData({ getSettings, getIdentity, isElectron: false });
  await getTrackCache().clearDB();
  player = createPlayer({
    store,
    storage,
    getSettings,
    getIdentity,
    platform: { publish() {}, progress() {}, dispose() {} },
    onFeedback: event => feedback.push(event),
    audio: {
      prepare: async (_resource, callbacks) => {
        let disposed = false;
        const handle = {
          play: () => callbacks.onPlay(),
          pause: () => callbacks.onPause(),
          position: () => 12,
          seek() {},
          setVolume() {},
          dispose: () => {
            disposed = true;
          },
          get disposed() {
            return disposed;
          },
        };
        handles.push(handle);
        return handle;
      },
    },
    setInterval: () => 0,
    clearInterval() {},
  });
});
afterEach(async () => {
  player.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
});

test.each(['/playlist/detail', '/song/detail', '/song/url'])(
  'real HTTP failure at %s terminates selection and releases previous audio',
  async endpoint => {
    expect((await player.playTracks([1])).status).toBe('completed');
    const old = handles[0];
    failure = endpoint;
    const result = await (endpoint === '/playlist/detail'
      ? player.playPlaylist(12345)
      : player.playTracks([2]));
    expect(result.status).toBe('failed');
    expect(old.disposed).toBe(true);
    expect(player.state).toMatchObject({
      playing: false,
      sourceInfo: null,
      progress: 0,
    });
    expect(feedback).toHaveLength(1);
  }
);

test('real HTTP FM failure clears loading and returns a public failed result', async () => {
  failure = '/personal_fm';
  expect((await player.playPersonalFM()).status).toBe('failed');
  expect(player.state.personalFMLoading).toBe(false);
  expect(player.state.personalFMNextLoading).toBe(false);
  expect(feedback).toHaveLength(1);
});

test('NetEase report HTTP failure reaches its error exit while Last.fm remains independent', async () => {
  failure = '/scrobble';
  const errors = [];
  let finish;
  const failed = new Promise(resolve => {
    finish = resolve;
  });
  const lastfm = [];
  const report = createPlaybackReporting({
    neteaseScrobble: scrobble,
    lastfmScrobble: async () => {
      lastfm.push('record');
    },
    getLastfmAuthorization: () => ({ key: 'independent' }),
    onError: error => {
      errors.push(error);
      finish();
    },
  });
  report({
    type: 'ended',
    track: track(1),
    durationSeconds: 100,
    completed: true,
    source: { id: 12 },
    recordOnce: () => true,
  });
  await failed;
  expect(errors).toHaveLength(1);
  expect(lastfm).toEqual(['record']);
});

test('real HTTP FM discard failure is not returned as a completed operation', async () => {
  expect((await player.playPersonalFM()).status).toBe('completed');
  failure = '/fm_trash';
  const result = await player.discardFMTrack();
  expect(result.status).toBe('failed');
  expect(player.state.personalFMNextLoading).toBe(false);
  expect(feedback).toHaveLength(1);
});

test('real lyric HTTP failure publishes empty raw lyrics, then acknowledged metadata, and releases the platform', async () => {
  failure = '/lyric';
  const ipc = new EventEmitter();
  const sent = [];
  ipc.send = (channel, value) => sent.push([channel, value]);
  const platform = createPlaybackPlatform({
    playback: player,
    lyrics: player.lyrics,
    ipc,
    navigator: {},
    window,
    document,
    createMpris: true,
    createTouchBar: false,
    createTray: false,
    settings: () => ({ enableOsdlyricsSupport: true }),
  });
  try {
    await player.playTracks([9]);
    platform.publish(player.state);
    await player.lyrics.retry();
    expect(player.lyrics.state.status).toBe('failed');
    const raw = sent.filter(([channel]) => channel === 'sendLyrics').pop();
    expect(raw[1]).toMatchObject({ track: { id: 9 }, lyrics: '' });
    expect(sent.filter(([channel]) => channel === 'metadata')).toHaveLength(0);
    ipc.emit('saveLyricFinished', {}, raw[1].requestId);
    expect(
      sent.filter(([channel]) => channel === 'metadata').pop()[1].trackId
    ).toBe(9);
  } finally {
    platform.dispose();
  }
  expect(ipc.listenerCount('saveLyricFinished')).toBe(0);
});

test('an independently rejected audio download has a background exit without delaying the playable descriptor', async () => {
  const error = new Error('download rejected');
  const settings = () => ({
    musicQuality: 128000,
    automaticallyCacheSongs: true,
    cacheLimit: false,
  });
  configureMusicData({
    getSettings: settings,
    getIdentity: () => ({ hasAccount: true }),
    isElectron: true,
    download: async () => {
      throw error;
    },
  });
  let finish;
  const failed = new Promise(resolve => {
    finish = resolve;
  });
  const resources = createAudioResources({
    cache: getTrackCache(),
    getMP3,
    settings,
    hasAccount: () => true,
    onBackgroundError: finish,
  });
  expect(await resources.resolve(track(20))).toMatchObject({
    kind: 'url',
    url: 'https://audio.test/song',
  });
  expect(await failed).toBe(error);
});

test.each([
  ['playPersonalFM', '/song/detail'],
  ['playPersonalFM', '/song/url'],
  ['next', '/song/detail'],
  ['next', '/song/url'],
])(
  'FM %s stops after %s HTTP selection failure without starting another FM load',
  async (operation, endpoint) => {
    expect((await player.playTracks([1])).status).toBe('completed');
    const old = handles[0];
    fmTracks = [track(6)];
    failure = endpoint;
    const result = await (operation === 'next'
      ? player.next({ personalFM: true })
      : player.playPersonalFM());
    expect(result.status).toBe('failed');
    expect(player.state).toMatchObject({
      personalFMLoading: false,
      personalFMNextLoading: false,
      playing: false,
      sourceInfo: null,
    });
    expect(old.disposed).toBe(true);
    expect(feedback).toHaveLength(1);
    await player.lyrics.retry();
    expect(requests.filter(path => path === '/personal_fm')).toHaveLength(1);
  }
);
