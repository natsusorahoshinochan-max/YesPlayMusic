/** @jest-environment node */
import 'fake-indexeddb/auto';
import { createPlayer } from '@/application/player';
import request from '@/utils/request';

jest.mock('@/utils/request', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/store', () => ({
  __esModule: true,
  default: { getters: { 'session/hasAccount': true } },
}));

const track = id => ({ id, name: `Track ${id}`, dt: 120000, ar: [], al: {} });
test('the production assembly reads each real source endpoint and plays through one Playback instance', async () => {
  global.window = { URL: {}, Blob: class {} };
  const requests = [];
  request.mockImplementation(async config => {
    requests.push(config);
    if (config.url === '/playlist/detail')
      return { playlist: { trackIds: [{ id: 101 }, { id: 102 }], tracks: [] } };
    if (config.url === '/album')
      return { album: { id: 202 }, songs: [track(201), track(202)] };
    if (config.url === '/artists')
      return { hotSongs: [track(301), track(302)] };
    if (config.url === '/playmode/intelligence/list')
      return { data: [track(401), track(402)] };
    if (config.url === '/song/detail')
      return {
        songs: String(config.params.ids)
          .split(',')
          .map(id => track(Number(id))),
        privileges: [],
      };
    if (config.url === '/song/url')
      return { data: [{ url: '/audio.mp3', br: 320000, freeTrialInfo: null }] };
    throw new Error(`Unexpected endpoint: ${config.url}`);
  });
  const notify = jest.fn();
  const playback = createPlayer({
    store: {
      state: { lastfm: {} },
      getters: { 'preferences/settings': {}, 'session/hasAccount': true },
      dispatch: notify,
    },
    audio: {
      prepare: async (_, options) => ({
        play: options.onPlay,
        pause: options.onPause,
        position: () => 0,
        setVolume() {},
        seek() {},
        dispose() {},
        applyOutputDevice() {},
      }),
    },
    setInterval: () => 1,
    clearInterval() {},
  });
  try {
    await playback.playPlaylist(100, { fresh: true, startTrackId: 102 });
    expect(playback.state.currentTrackID).toBe(102);
    expect(
      requests.find(item => item.url === '/playlist/detail').params
    ).toEqual({ id: 100, timestamp: expect.any(Number) });
    await playback.playAlbum(200, { startTrackId: 202 });
    expect(playback.state.currentTrackID).toBe(202);
    expect(playback.state.playlistSource).toEqual({ type: 'album', id: 200 });
    await playback.playArtist(300);
    expect(playback.state.currentTrackID).toBe(301);
    await playback.playIntelligencePlaylist(400, {
      fresh: true,
      startTrackId: 402,
    });
    expect(playback.state.currentTrackID).toBe(402);
    expect(playback.state.playlistSource).toEqual({
      type: 'playlist',
      id: 400,
    });
    expect(
      requests.find(item => item.url === '/playmode/intelligence/list').params
    ).toEqual({ id: expect.any(Number), pid: 400 });
    expect(notify).not.toHaveBeenCalled();
  } finally {
    playback.dispose();
    delete global.window;
  }
});

test('a production source request failure reaches the application feedback outlet once', async () => {
  global.window = { URL: {}, Blob: class {} };
  request.mockRejectedValue(new Error('source offline'));
  const dispatch = jest.fn();
  const playback = createPlayer({
    store: {
      state: { lastfm: {} },
      getters: { 'preferences/settings': {}, 'session/hasAccount': true },
      dispatch,
    },
    setInterval: () => 1,
    clearInterval() {},
  });
  try {
    expect(await playback.playPlaylist(900)).toMatchObject({
      status: 'failed',
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('showToast', '播放失败，请稍后重试');
  } finally {
    playback.dispose();
    delete global.window;
  }
});
