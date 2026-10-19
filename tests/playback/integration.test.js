import 'fake-indexeddb/auto';
import { Howl } from 'howler';
import axios from 'axios';
import request from '@/utils/request';
import { createStore } from '@/store';
import { createPlayer } from '@/application/player';
import { clearDB, countDBSize, getTrackSource } from '@/utils/db';

jest.mock('@/utils/request', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('howler', () => ({ Howl: jest.fn() }));

const track = id => ({
  id,
  name: `Track ${id}`,
  dt: 200900,
  ar: [{ name: 'Artist' }],
  al: { name: 'Album' },
  no: 2,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let originalEnvironment;
let ipc;
let audio;
let lifecycle;
let player;

beforeAll(() => {
  // Electron's build-time boolean is a platform input, not a string env flag.
  originalEnvironment = process.env;
  process.env = { ...originalEnvironment, IS_ELECTRON: true };
});
afterAll(() => {
  process.env = originalEnvironment;
});
beforeEach(async () => {
  await clearDB();
  localStorage.clear();
  localStorage.setItem(
    'settings',
    JSON.stringify({
      automaticallyCacheSongs: true,
      cacheLimit: false,
      outputDevice: 'speakers',
    })
  );
  localStorage.setItem('data', JSON.stringify({ loginMode: 'account' }));
  audio = [];
  lifecycle = [];
  ipc = {
    send: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    invoke: jest.fn(async () => null),
  };
  window.require = () => ({ ipcRenderer: ipc });
  window.URL.createObjectURL = jest.fn(
    () => `blob:audio-${window.URL.createObjectURL.mock.calls.length}`
  );
  window.URL.revokeObjectURL = jest.fn(url => lifecycle.push(['revoke', url]));
  Howl.mockImplementation(function (options) {
    const listeners = {};
    let position = 0;
    this.src = options.src[0];
    this.on = (name, callback) => {
      listeners[name] = callback;
    };
    this.off = name => {
      delete listeners[name];
      lifecycle.push(['off', this.src, name]);
    };
    this.load = () => listeners.load();
    this.play = () => listeners.play?.();
    this.pause = () => listeners.pause?.();
    this.seek = value => {
      if (value !== undefined) position = value;
      return position;
    };
    this.volume = jest.fn();
    this.unload = () => lifecycle.push(['unload', this.src]);
    this._sounds = [{ _node: { setSinkId: jest.fn(async () => {}) } }];
    audio.push(this);
  });
  axios.get.mockResolvedValue({ data: new Uint8Array([9, 8, 7]).buffer });
  request.mockImplementation(async config => {
    if (config.url === '/playlist/detail')
      return { playlist: { trackIds: [{ id: 1 }], tracks: [] } };
    if (config.url === '/album')
      return { album: { id: config.params.id }, songs: [track(2)] };
    if (config.url === '/artists') return { hotSongs: [track(3)] };
    if (config.url === '/playmode/intelligence/list')
      return { data: [track(4)] };
    if (config.url === '/song/detail') {
      const id = Number(config.params.ids);
      return { songs: [track(id)], privileges: [{ id, pl: 320000 }] };
    }
    if (config.url === '/song/url')
      return {
        data: [
          {
            url: `http://audio/${config.params.id}.mp3`,
            br: 320000,
            freeTrialInfo: null,
          },
        ],
      };
    if (config.url === '/personal_fm') return { data: [track(80), track(81)] };
    if (config.url === '/scrobble') return { code: 200 };
    throw new Error(`Unexpected endpoint ${config.url}`);
  });
});
afterEach(async () => {
  player?.dispose();
  player = null;
  await clearDB();
  delete window.require;
  delete window.URL.createObjectURL;
  delete window.URL.revokeObjectURL;
});
function assemble() {
  const notify = jest.fn();
  const store = createStore({
    credentials: { get: () => 'controlled-token', set() {}, remove() {} },
    actions: { showToast: notify },
  });
  player = createPlayer({ store, setInterval: () => 1, clearInterval() {} });
  store.state.player = player;
  return { store, notify };
}

test('all source operations share real metadata, committed audio cache and adapter resource ownership', async () => {
  const { store, notify } = assemble();
  await player.playPlaylist(10, { fresh: true });
  expect(player.state.currentTrack).toMatchObject({
    id: 1,
    name: 'Track 1',
    privilege: { pl: 320000 },
  });
  expect(await countDBSize()).toEqual({ bytes: 3, length: 1 });
  expect(await getTrackSource(1)).toMatchObject({
    from: 'netease',
    bitRate: 320000,
  });
  await player.playAlbum(20);
  await player.playArtist(30);
  await player.playIntelligencePlaylist(40, { fresh: true });
  expect(player).toBe(store.state.player);
  expect(player.state).toMatchObject({
    currentTrackID: 4,
    playlistSource: { type: 'playlist', id: 40 },
  });
  expect(await countDBSize()).toEqual({ bytes: 12, length: 4 });
  await player.playTracks([1], { source: { type: 'album', id: 50 } });
  expect(player.state.sourceInfo).toEqual({
    from: 'netease',
    bitRate: 320000,
    cached: true,
  });
  expect(audio.map(instance => instance.src)).toEqual([
    'https://audio/1.mp3',
    'https://audio/2.mp3',
    'https://audio/3.mp3',
    'https://audio/4.mp3',
    'blob:audio-1',
  ]);
  expect(
    request.mock.calls.filter(
      ([config]) => config.url === '/song/detail' && config.params.ids === 1
    )
  ).toHaveLength(2);
  expect(
    request.mock.calls.filter(
      ([config]) => config.url === '/song/url' && config.params.id === 1
    )
  ).toHaveLength(1);
  expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();
  await player.playTracks([2]);
  const oldURL = 'blob:audio-1';
  const unload = lifecycle.findIndex(
    item => item[0] === 'unload' && item[1] === oldURL
  );
  const revoke = lifecycle.findIndex(
    item => item[0] === 'revoke' && item[1] === oldURL
  );
  expect(unload).toBeGreaterThan(-1);
  expect(revoke).toBeGreaterThan(unload);
  expect(
    lifecycle
      .slice(0, unload)
      .filter(item => item[0] === 'off' && item[1] === oldURL)
  ).toHaveLength(6);
  expect(
    audio.every(
      instance =>
        instance._sounds[0]._node.setSinkId.mock.calls[0][0] === 'speakers'
    )
  ).toBe(true);
  expect(notify).not.toHaveBeenCalled();
});

test('Electron fallback bytes use the same adapter and preserve provider provenance in the committed cache', async () => {
  const remote = request.getMockImplementation();
  request.mockImplementation(config =>
    config.url === '/song/url'
      ? Promise.resolve({ data: [{ url: null, freeTrialInfo: null }] })
      : remote(config)
  );
  ipc.invoke.mockResolvedValue({ source: 'bilibili', url: 'CQgH' });
  const { notify } = assemble();
  expect(await player.playTracks([5])).toEqual({ status: 'completed' });
  expect(player.state.sourceInfo).toEqual({
    from: 'unm:bilibili',
    bitRate: 128000,
    cached: false,
  });
  expect(audio[0].src).toBe('blob:audio-1');
  expect(ipc.invoke).toHaveBeenCalledWith(
    'unblock-music',
    expect.anything(),
    expect.objectContaining({ id: 5 }),
    expect.any(Object)
  );
  expect(await countDBSize()).toEqual({ bytes: 3, length: 1 });
  await player.playTracks([5]);
  expect(player.state.sourceInfo).toEqual({
    from: 'unm:bilibili',
    bitRate: 128000,
    cached: true,
  });
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio-1');
  expect(notify).not.toHaveBeenCalled();
});

test('no source skips under the same operation while failed background cache leaves the playable song intact', async () => {
  const remote = request.getMockImplementation();
  request.mockImplementation(config =>
    config.url === '/song/url' && config.params.id === 5
      ? Promise.resolve({ data: [{ url: null, freeTrialInfo: null }] })
      : remote(config)
  );
  const failure = new Error('download offline');
  axios.get.mockRejectedValue(failure);
  const log = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const { notify } = assemble();
  expect(
    await player.playTracks([5, 6], { source: { type: 'playlist', id: 10 } })
  ).toEqual({ status: 'unavailable', reason: 'no-source' });
  expect(player.state).toMatchObject({
    currentTrackID: 6,
    playing: true,
    sourceInfo: { from: 'netease', cached: false },
  });
  expect(audio.map(instance => instance.src)).toEqual(['https://audio/6.mp3']);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(expect.anything(), '无法播放 Track 5');
  expect(log).toHaveBeenCalledWith(
    '[audio cache] background write failed',
    failure
  );
  expect(await countDBSize()).toEqual({ bytes: 0, length: 0 });
});

test('late rejected source requests cannot publish feedback or replace a newer complete source selection', async () => {
  const remote = request.getMockImplementation();
  const old = deferred();
  const started = deferred();
  request.mockImplementation(config => {
    if (config.url === '/playlist/detail') {
      started.resolve();
      return old.promise;
    }
    return remote(config);
  });
  const { notify } = assemble();
  const oldSelection = player.playPlaylist(10);
  await started.promise;
  expect(await player.playAlbum(20)).toEqual({ status: 'completed' });
  old.reject(new Error('old playlist offline'));
  expect(await oldSelection).toEqual({ status: 'superseded' });
  expect(player.state).toMatchObject({
    currentTrackID: 2,
    playlistSource: { type: 'album', id: 20 },
    playing: true,
  });
  expect(audio.map(instance => instance.src)).toEqual(['https://audio/2.mp3']);
  expect(notify).not.toHaveBeenCalled();
});

test('late restored resources and cold FM results cannot overwrite the user source, audio or durable archive', async () => {
  const remote = request.getMockImplementation();
  const restoredResource = deferred();
  const restoring = deferred();
  const recommendations = deferred();
  request.mockImplementation(config => {
    if (config.url === '/song/url' && config.params.id === 1) {
      restoring.resolve();
      return restoredResource.promise;
    }
    if (config.url === '/personal_fm') return recommendations.promise;
    return remote(config);
  });
  localStorage.setItem(
    'player',
    JSON.stringify({
      _enabled: true,
      _list: [1],
      _currentTrack: track(1),
      _playlistSource: { type: 'playlist', id: 10 },
    })
  );
  localStorage.setItem('playerCurrentTrackTime', '15');
  const { notify } = assemble();
  const restoration = player.restoreSaved();
  await restoring.promise;
  expect(await player.playAlbum(20)).toEqual({ status: 'completed' });
  restoredResource.resolve({
    data: [
      { url: 'http://audio/restored.mp3', br: 320000, freeTrialInfo: null },
    ],
  });
  recommendations.resolve({ data: [track(80), track(81)] });
  expect(await restoration).toEqual({ status: 'superseded' });
  expect(player.state).toMatchObject({
    currentTrackID: 2,
    playlistSource: { type: 'album', id: 20 },
    progress: 0,
    playing: true,
    personalFMTrack: { id: 0 },
  });
  expect(audio.map(instance => instance.src)).toEqual(['https://audio/2.mp3']);
  expect(JSON.parse(localStorage.getItem('player'))).toMatchObject({
    _currentTrack: { id: 2 },
    _list: [2],
    _playlistSource: { type: 'album', id: 20 },
    _personalFMTrack: { id: 0 },
  });
  expect(notify).not.toHaveBeenCalled();
});
