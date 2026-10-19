import 'fake-indexeddb/auto';
import http from 'http';
import httpAdapter from 'axios/lib/adapters/http';
import request, { configureRequest } from '@/utils/request';
import { configureMusicData } from '@/application/musicData';
import { getLyric, getCloudLyric, getTrackDetail } from '@/api/track';
import { getAlbum } from '@/api/album';
import {
  getLyricFromCache,
  getAlbumFromCache,
  getTrackDetailFromCache,
} from '@/utils/db';
import { createLyrics } from '@/lyrics';
let server, origin, response;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    response(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  request.defaults.adapter = httpAdapter;
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: origin, configure: c => c },
  });
  configureMusicData({
    getSettings: () => ({}),
    getIdentity: () => ({ hasAccount: true }),
    isElectron: false,
  });
  response = (req, res) => {
    res.writeHead(503);
    res.end('{}');
  };
});
const json = data => (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};
test('cloud lyric failure settles the content owner as failed and never creates a cache entry; retry adopts real content', async () => {
  const playback = {
    state: { sourceInfo: {}, currentTrack: { id: 36601, pc: {} } },
    position: () => 0,
  };
  const lyrics = createLyrics({
    playback,
    getIdentity: () => ({ hasAccount: true, userId: 1 }),
    getLyric,
    getCloudLyric,
  });
  lyrics.sync();
  await lyrics.retry();
  expect(lyrics.state.status).toBe('failed');
  expect(await getLyricFromCache('cloud:1:36601')).toBeUndefined();
  response = json({ code: 200, lrc: '[00:00.00]Recovered' });
  await lyrics.retry();
  expect(lyrics.state.currentLine).toBe('Recovered');
  lyrics.dispose();
});
test('invalid remote lyric data fails without poisoning the ordinary cache', async () => {
  response = json({ code: 200, lrc: { lyric: 12 } });
  await expect(getLyric(36602)).rejects.toThrow();
  expect(await getLyricFromCache(36602)).toBeUndefined();
});
test('invalid album songs fail before cache adoption', async () => {
  response = json({ album: { id: 36603 }, songs: 'invalid' });
  await expect(getAlbum(36603)).rejects.toThrow();
  expect(await getAlbumFromCache(36603)).toBeUndefined();
});
test('a malformed later song cannot partially populate the shared track cache', async () => {
  response = json({ songs: [{ id: 36604 }, null], privileges: [] });
  await expect(getTrackDetail('36604,36605')).rejects.toThrow();
  expect(await getTrackDetailFromCache(['36604'])).toBeUndefined();
});

import { shallowMount } from '@vue/test-utils';
import Explore from '@/views/explore.vue';
import NProgress from 'nprogress';
const pageOptions = {
  mocks: {
    $t: x => x,
    $route: { query: {}, params: {} },
    $store: {
      getters: { 'preferences/settings': { enabledPlaylistCategories: [] } },
      dispatch: jest.fn(),
    },
  },
};
test('discovery HTTP failure completes the full load, retains available playlists and cancels delayed progress', async () => {
  const page = shallowMount(Explore, {
    ...pageOptions,
    router: new VueRouter({ mode: 'abstract' }),
  });
  page.vm.playlists = [{ id: 9 }];
  page.vm.activeCategory = '全部';
  const start = jest.spyOn(NProgress, 'start').mockImplementation(() => {});
  jest.spyOn(NProgress, 'done').mockImplementation(() => {});
  await page.vm.loadData();
  expect(page.vm.loadingMore).toBe(false);
  expect(page.vm.playlists).toEqual([{ id: 9 }]);
  page.destroy();
  await new Promise(resolve => setTimeout(resolve, 1050));
  expect(start).not.toHaveBeenCalled();
});

import { createMusicSearchQuery } from '@/musicSearch/query';
test('search waits for detail HTTP failure and keeps its successful first page available', async () => {
  let page = 0;
  response = (req, res) => {
    if (req.url.startsWith('/search'))
      return json({
        result: { songs: [{ id: page++ ? 36607 : 36606 }], songCount: 3 },
      })(req, res);
    if (page === 1)
      return json({ songs: [{ id: 36606 }], privileges: [] })(req, res);
    res.writeHead(503);
    res.end('{}');
  };
  const query = createMusicSearchQuery();
  await query.replace({ keywords: 'song', category: 'tracks' });
  await query.loadNext();
  expect(query.state.loading).toBe(false);
  expect(query.state.error).toBeInstanceOf(Error);
  expect(query.state.results.tracks.map(t => t.id)).toEqual([36606]);
  query.dispose();
});
test('search does not adopt an invalid non-array result as success', async () => {
  response = json({ result: { artists: 'invalid', artistCount: 1 } });
  const query = createMusicSearchQuery();
  await query.replace({ keywords: 'artist', category: 'artists' });
  expect(query.state.error).toBeInstanceOf(Error);
  expect(query.state.results.artists).toEqual([]);
  query.dispose();
});

import Album from '@/views/album.vue';
import VueRouter from 'vue-router';
test('album load waits for nested details and preserves its available songs when the supplement fails', async () => {
  const router = new VueRouter({
    mode: 'abstract',
    routes: [{ path: '/album/:id' }],
  });
  await router.push('/album/36608');
  const page = shallowMount(Album, {
    ...pageOptions,
    router,
    stubs: { 'router-link': true },
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  let release;
  response = (req, res) => {
    if (req.url.startsWith('/album?'))
      return json({
        album: { id: 36608, name: 'Album', artist: { id: 3 } },
        songs: [{ id: 36609, dt: 10 }],
      })(req, res);
    if (req.url.startsWith('/song/detail')) {
      release = () => {
        res.writeHead(503);
        res.end('{}');
      };
      return;
    }
    if (req.url.startsWith('/artist/album'))
      return json({ hotAlbums: [] })(req, res);
    return json({ code: 200 })(req, res);
  };
  let finished = false;
  const pending = Promise.resolve(page.vm.loadData(36608)).then(() => {
    finished = true;
  });
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  expect(finished).toBe(false);
  release();
  await pending;
  expect(page.vm.tracks.map(t => t.id)).toEqual([36609]);
  expect(page.vm.show).toBe(true);
  page.destroy();
});

jest.mock('@/assets/css/plyr.css', () => ({}));
jest.mock(
  'plyr',
  () =>
    class {
      on() {}
      destroy() {}
    }
);
import Mv from '@/views/mv.vue';
test('MV complete load waits for nested URL reads and fails without replacing the available video source', async () => {
  const router = new VueRouter({
    mode: 'abstract',
    routes: [{ path: '/mv/:id' }],
  });
  await router.push('/mv/36610');
  const page = shallowMount(Mv, {
    ...pageOptions,
    router,
    mocks: {
      ...pageOptions.mocks,
      $store: {
        state: { player: { state: { volume: 1 } } },
        dispatch: jest.fn(),
      },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  const available = { title: 'Available' };
  page.vm.player.source = available;
  let release;
  response = (req, res) => {
    if (req.url.startsWith('/mv/detail'))
      return json({
        data: {
          id: 36610,
          name: 'New',
          brs: [{ br: 1080 }],
          cover: 'https://test/cover',
        },
      })(req, res);
    if (req.url.startsWith('/mv/url')) {
      release = () => {
        res.writeHead(503);
        res.end('{}');
      };
      return;
    }
    return json({ mvs: [] })(req, res);
  };
  let finished = false;
  const pending = Promise.resolve(page.vm.getData(36610)).then(() => {
    finished = true;
  });
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  const returnedEarly = finished;
  release();
  await pending;
  expect(returnedEarly).toBe(false);
  expect(page.vm.player.source).toEqual(available);
  page.destroy();
});

import Home from '@/views/home.vue';
import { createStore } from '@/store';
test('home failure settles all sections and its delayed progress without dropping available releases', async () => {
  const store = createStore({
    storage: { getItem: () => null, setItem() {} },
    credentials: { get: () => null },
    language: 'en',
  });
  const page = shallowMount(Home, {
    store,
    mocks: { $t: x => x },
    stubs: { 'router-link': true },
  });
  page.vm.newReleasesAlbum.items = [{ id: 99 }];
  expect(page.vm.loadData()).toBeInstanceOf(Promise);
  await page.vm.loadData();
  expect(page.vm.newReleasesAlbum.items).toEqual([{ id: 99 }]);
  expect(page.vm.show).toBe(true);
  page.destroy();
});

import Artist from '@/views/artist.vue';
test('artist failure completes navigation and load while preserving the successful content', async () => {
  const page = shallowMount(Artist, {
    ...pageOptions,
    stubs: { 'router-link': true },
  });
  page.vm.$parent.$refs.main = { scrollTo() {} };
  page.vm.albumsData = [{ id: 88 }];
  const next = jest.fn();
  const pending = page.vm.loadData(36611, next);
  expect(pending).toBeInstanceOf(Promise);
  await pending;
  expect(next).toHaveBeenCalledTimes(1);
  expect(page.vm.albumsData).toEqual([{ id: 88 }]);
  page.destroy();
});

import ArtistMV from '@/views/artistMV.vue';
import NewAlbum from '@/views/newAlbum.vue';
test.each([
  [ArtistMV, '/artist-mv/36612', 'loadData'],
  [NewAlbum, '/new-album', 'loadData'],
])(
  '%s read failure settles without adopting unavailable collections',
  async (component, path, method) => {
    const router = new VueRouter({
      mode: 'abstract',
      routes: [{ path: '/artist-mv/:id' }, { path: '/new-album' }],
    });
    await router.push(path);
    const page = shallowMount(component, { ...pageOptions, router });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(page.vm[method]).toBeInstanceOf(Function);
    const pending = page.vm[method]();
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    page.destroy();
  }
);

import LoginUsername from '@/views/loginUsername.vue';
test('public identity search failure ends pending state and preserves the last selectable identity', async () => {
  const page = shallowMount(LoginUsername, pageOptions);
  page.vm.keyword = 'user';
  page.vm.result = [{ userId: 2, nickname: 'Available' }];
  page.vm.activeUser = page.vm.result[0];
  await page.vm.search();
  expect(page.vm.searching).toBe(false);
  expect(page.vm.activeUser.nickname).toBe('Available');
  page.destroy();
});

import { cacheLyric } from '@/utils/db';
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore';
test('legitimate empty lyrics remain successful while malformed HTTP bodies never enter the cache', async () => {
  response = json({ code: 200, nolyric: true });
  expect(await getLyric(36613)).toMatchObject({ nolyric: true });
  response = json({ code: 200, lrc: '' });
  expect(await getCloudLyric(36613, 5)).toMatchObject({ lrc: '' });
  response = (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{malformed');
  };
  await expect(getLyric(36614)).rejects.toThrow();
  expect(await getLyricFromCache(36614)).toBeUndefined();
});
test('a valid cached lyric remains available across failed background refresh, and old malformed entries fall through to remote', async () => {
  await cacheLyric(36615, { lrc: { lyric: '[00:00.00]Available' } });
  expect((await getLyric(36615)).lrc.lyric).toContain('Available');
  await new Promise(resolve => setTimeout(resolve, 20));
  expect((await getLyricFromCache(36615)).lrc.lyric).toContain('Available');
  await cacheLyric(36616, { code: 503 });
  response = json({ lrc: { lyric: '[00:00.00]Recovered' } });
  expect((await getLyric(36616)).lrc.lyric).toContain('Recovered');
});
test('rejectable IndexedDB write finishes lyric content load as failed and leaves retry available', async () => {
  response = json({ lrc: { lyric: '[00:00.00]Stored' } });
  const put = jest
    .spyOn(FDBObjectStore.prototype, 'put')
    .mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
  const playback = {
    state: { sourceInfo: {}, currentTrack: { id: 36617 } },
    position: () => 0,
  };
  const lyrics = createLyrics({
    playback,
    getIdentity: () => ({ hasAccount: false }),
    getLyric,
    getCloudLyric,
  });
  lyrics.sync();
  await lyrics.retry();
  expect(lyrics.state.status).toBe('failed');
  put.mockRestore();
  await lyrics.retry();
  expect(lyrics.state.currentLine).toBe('Stored');
  lyrics.dispose();
});

import { dailyRecommendTracks } from '@/api/playlist';
test('the actual daily owner ends a malformed HTTP load and the same public operation can retry an empty success', async () => {
  const store = createStore({
    storage: {
      getItem: key =>
        key === 'data'
          ? JSON.stringify({ loginMode: 'account', user: { userId: 1 } })
          : null,
      setItem() {},
    },
    credentials: { get: () => 'account' },
    language: 'en',
    dailyRecommendations: { read: dailyRecommendTracks },
  });
  response = (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{malformed');
  };
  await store.dispatch('dailyRecommendations/load');
  expect(store.state.dailyRecommendations.status).toBe('error');
  response = json({ data: { dailySongs: [], privileges: [] } });
  await store.dispatch('dailyRecommendations/load');
  expect(store.state.dailyRecommendations.status).toBe('loaded');
  expect(store.state.dailyRecommendations.tracks).toEqual([]);
});

test('invalid privileges cannot populate track cache before playable conversion fails', async () => {
  response = json({
    songs: [{ id: 36618 }, { id: 36619 }],
    privileges: [{ id: 36618 }, null],
  });
  await expect(getTrackDetail(36618)).rejects.toThrow();
  expect(await getTrackDetailFromCache(['36618'])).toBeUndefined();
});
