import 'fake-indexeddb/auto';
import { createMusicSearchQuery } from '@/musicSearch/query';
import { configureRequest } from '@/utils/request';
import request from '@/utils/request';
import { configureMusicData } from '@/application/musicData';
import { getTrackCache } from '@/utils/db';

let requests;
let respond;
beforeEach(async () => {
  requests = [];
  configureMusicData({
    getSettings: () => ({ cacheLimit: false }),
    getIdentity: () => ({ hasAccount: false }),
  });
  await getTrackCache().clearDB();
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: '', configure: config => config },
  });
  request.defaults.adapter = async config => {
    requests.push({ url: config.url, ...config.params });
    const data = await respond(config);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
});

test('independent complete queries accumulate only new track pages and retain remote cursor', async () => {
  respond = config =>
    config.url === '/search'
      ? {
          result: {
            songs: [{ id: config.params.offset === 0 ? 1 : 2 }],
            hasMore: config.params.offset === 0,
          },
        }
      : {
          songs: [
            {
              id: Number(config.params.ids),
              name: `Detail ${config.params.ids}`,
            },
          ],
          privileges: [],
        };
  const first = createMusicSearchQuery();
  const second = createMusicSearchQuery();
  await first.replace({ keywords: 'first', category: 'tracks' });
  await second.replace({ keywords: 'other', category: 'artists' });
  await first.loadNext();
  expect(first.state.results.tracks.map(track => track.name)).toEqual([
    'Detail 1',
    'Detail 2',
  ]);
  expect(first.state.hasMore).toBe(false);
  expect(second.state.results.tracks).toEqual([]);
  expect(
    requests.filter(item => item.url === '/song/detail').map(item => item.ids)
  ).toEqual(['1', '2']);
  expect(
    requests.filter(item => item.keywords === 'first').map(item => item.offset)
  ).toEqual([0, 1]);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('replacement and disposal reject late searches and late metadata', async () => {
  const detail = deferred();
  const detailsStarted = deferred();
  const oldSearch = deferred();
  respond = config => {
    if (config.url === '/song/detail') {
      detailsStarted.resolve();
      return detail.promise;
    }
    if (config.params.keywords === 'old-search') return oldSearch.promise;
    return { result: { songs: [{ id: 8 }], artists: [{ id: 2 }] } };
  };
  const query = createMusicSearchQuery();
  const old = query.replace({ keywords: 'old-search', category: 'artists' });
  const tracks = query.replace({ keywords: 'old-details', category: 'tracks' });
  await detailsStarted.promise;
  await query.replace({ keywords: 'current', category: 'artists' });
  detail.resolve({ songs: [{ id: 8, name: 'Stale' }], privileges: [] });
  oldSearch.resolve({ result: { artists: [{ id: 100 }] } });
  await Promise.all([old, tracks]);
  expect(query.state.results.artists).toEqual([{ id: 2 }]);
  expect(query.state.results.tracks).toEqual([]);
  const pending = deferred();
  respond = () => pending.promise;
  const loading = query.replace({ keywords: 'disposed', category: 'albums' });
  query.dispose();
  pending.resolve({ result: { albums: [{ id: 5 }] } });
  await loading;
  expect(query.state.results.albums).toEqual([]);
  expect(query.state.loading).toBe(false);
});

test('overview maps all categories while empty and failed requests finish loading', async () => {
  respond = config => ({
    result: {
      100: { artists: [{ id: 1 }] },
      10: { albums: [{ id: 2 }] },
      1: { songs: [] },
      1004: { mvs: [{ id: 4 }] },
      1000: { playlists: [{ id: 5 }] },
    }[config.params.type],
  });
  const query = createMusicSearchQuery();
  await query.replace({ keywords: 'overview', category: 'overview' });
  expect(query.state.results).toEqual({
    tracks: [],
    artists: [{ id: 1 }],
    albums: [{ id: 2 }],
    musicVideos: [{ id: 4 }],
    playlists: [{ id: 5 }],
  });
  expect(requests.every(item => item.limit === 16)).toBe(true);
  respond = () => ({});
  await query.replace({ keywords: 'failed', category: 'tracks' });
  expect(query.state.loading).toBe(false);
  expect(query.state.loaded).toBe(true);
  expect(query.state.error).toBeInstanceOf(Error);
  respond = () => ({ result: {} });
  await query.replace({ keywords: 'empty', category: 'tracks' });
  expect(query.state.results.tracks).toEqual([]);
  expect(query.state.hasMore).toBe(false);
  expect(query.state.error).toBe(null);
});

test('legacy swallowed transport failure finishes the query with a useful failure', async () => {
  respond = () => {
    throw new Error('network offline');
  };
  const query = createMusicSearchQuery();
  await query.replace({ keywords: 'offline', category: 'tracks' });
  expect(query.state.loading).toBe(false);
  expect(query.state.error.message).toBe('搜索失败');
  expect(query.state.results.tracks).toEqual([]);
});

test('failed next page retains results and retries the same remote position', async () => {
  let fail = true;
  respond = config => {
    if (config.params.offset === 1 && fail) return {};
    return {
      result: { albums: [{ id: config.params.offset + 1 }], albumCount: 2 },
    };
  };
  const query = createMusicSearchQuery();
  await query.replace({ keywords: 'albums', category: 'albums' });
  await query.loadNext();
  expect(query.state.results.albums).toEqual([{ id: 1 }]);
  expect(query.state.loading).toBe(false);
  fail = false;
  await query.loadNext();
  expect(query.state.results.albums).toEqual([{ id: 1 }, { id: 2 }]);
  expect(query.state.hasMore).toBe(false);
  expect(requests.map(item => item.offset)).toEqual([0, 1, 1]);
});
