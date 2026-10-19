/** @jest-environment node */
import 'fake-indexeddb/auto';
import { getAlbum } from '@/api/album';
import request from '@/utils/request';
import { clearDB, cacheLyric, cacheTrackDetail, cacheAlbum } from '@/utils/db';
import { getLyric, getCloudLyric, getTrackDetail } from '@/api/track';

jest.mock('@/utils/request', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/store', () => ({
  __esModule: true,
  default: { getters: { 'session/hasAccount': false } },
}));

beforeEach(async () => {
  await clearDB();
});

test('ordinary lyric cache miss waits for one remote read', async () => {
  request.mockResolvedValue({ lrc: { lyric: 'ordinary lyric' } });
  await expect(getLyric(12)).resolves.toEqual({
    lrc: { lyric: 'ordinary lyric' },
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith({
    url: '/lyric',
    method: 'get',
    params: { id: 12 },
  });
});

test('cloud lyric cache miss preserves encrypted request parameters and reads once', async () => {
  request.mockResolvedValue({ lyric: 'cloud lyric', code: 200 });
  await expect(getCloudLyric(23, 99)).resolves.toEqual({
    lyric: 'cloud lyric',
    code: 200,
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith({
    url: '/api',
    method: 'get',
    params: {
      uri: '/api/cloud/lyric/get',
      data: { songId: 23, userId: 99, lv: '-1', kv: '-1' },
      crypto: 'eapi',
    },
  });
});

test('track detail miss reads once and keeps requested order, privileges and playable mapping', async () => {
  request.mockResolvedValue({
    songs: [
      { id: 1, fee: 1 },
      { id: 2, fee: 4 },
    ],
    privileges: [
      { id: 1, pl: 320000 },
      { id: 2, pl: 0 },
    ],
    code: 200,
  });
  const result = await getTrackDetail('2,1');
  expect(result).toEqual({
    songs: [
      {
        id: 2,
        fee: 4,
        privilege: { id: 2, pl: 0 },
        playable: false,
        reason: '付费专辑',
      },
      {
        id: 1,
        fee: 1,
        privilege: { id: 1, pl: 320000 },
        playable: true,
        reason: '',
      },
    ],
    privileges: [
      { id: 1, pl: 320000 },
      { id: 2, pl: 0 },
    ],
    code: 200,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

test('album miss reads once and converts playable songs', async () => {
  request.mockResolvedValue({
    album: { id: 30, name: 'Album' },
    songs: [{ id: 3, fee: 1 }],
    code: 200,
  });
  await expect(getAlbum(30)).resolves.toEqual({
    album: { id: 30, name: 'Album' },
    code: 200,
    songs: [
      { id: 3, fee: 1, privilege: {}, playable: false, reason: 'VIP Only' },
    ],
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith({
    url: '/album',
    method: 'get',
    params: { id: 30 },
  });
});

const cachedCases = [
  {
    name: 'ordinary lyric',
    read: () => getLyric(12),
    seed: () => cacheLyric(12, { lrc: { lyric: 'cached' } }),
    expected: { lrc: { lyric: 'cached' } },
  },
  {
    name: 'cloud lyric',
    read: () => getCloudLyric(23, 99),
    seed: () => cacheLyric(23, { lyric: 'cached cloud' }),
    expected: { lyric: 'cached cloud' },
  },
  {
    name: 'track detail',
    read: () => getTrackDetail('2,1,2'),
    seed: async () => {
      await cacheTrackDetail({ id: 1, fee: 1 }, { id: 1, pl: 320000 });
      await cacheTrackDetail({ id: 2, fee: 4 }, { id: 2, pl: 0 });
    },
    expected: {
      songs: [
        {
          id: 2,
          fee: 4,
          privilege: { id: 2, pl: 0 },
          playable: false,
          reason: '付费专辑',
        },
        {
          id: 1,
          fee: 1,
          privilege: { id: 1, pl: 320000 },
          playable: true,
          reason: '',
        },
        {
          id: 2,
          fee: 4,
          privilege: { id: 2, pl: 0 },
          playable: false,
          reason: '付费专辑',
        },
      ],
      privileges: [
        { id: 2, pl: 0 },
        { id: 1, pl: 320000 },
        { id: 2, pl: 0 },
      ],
    },
  },
  {
    name: 'album',
    read: () => getAlbum(30),
    seed: () =>
      cacheAlbum(30, { album: { id: 30 }, songs: [{ id: 3, fee: 1 }] }),
    expected: {
      album: { id: 30 },
      songs: [
        { id: 3, fee: 1, privilege: {}, playable: false, reason: 'VIP Only' },
      ],
    },
  },
];

test.each(cachedCases)(
  '$name hit returns before its single refresh finishes',
  async ({ seed, read, expected }) => {
    await seed();
    request.mockImplementation(() => new Promise(() => {}));
    await expect(read()).resolves.toEqual(expected);
    expect(request).toHaveBeenCalledTimes(1);
  }
);

test.each(cachedCases)(
  '$name hit receives background remote rejection and retains cached output',
  async ({ seed, read, expected }) => {
    await seed();
    let received;
    const failureHandled = new Promise(resolve => {
      received = resolve;
    });
    const error = new Error('remote offline');
    jest
      .spyOn(console, 'debug')
      .mockImplementation((message, reason) => received(reason));
    request.mockRejectedValue(error);
    await expect(read()).resolves.toEqual(expected);
    await expect(failureHandled).resolves.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(() => new Promise(() => {}));
    await expect(read()).resolves.toEqual(expected);
  }
);

test.each(cachedCases)(
  '$name hit receives background IndexedDB write failure',
  async ({ name, seed, read, expected }) => {
    await seed();
    let received;
    const failureHandled = new Promise(resolve => {
      received = resolve;
    });
    jest
      .spyOn(console, 'debug')
      .mockImplementation((message, reason) => received(reason));
    // Functions cannot be stored by IndexedDB's structured clone operation.
    const remote = JSON.parse(JSON.stringify(expected));
    if (name === 'track detail') remote.songs[0].uncloneable = () => {};
    else remote.uncloneable = () => {};
    request.mockResolvedValue(remote);
    await expect(read()).resolves.toEqual(expected);
    await expect(failureHandled).resolves.toMatchObject({
      name: 'DataCloneError',
    });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(() => new Promise(() => {}));
    await expect(read()).resolves.toEqual(expected);
  }
);

test.each(cachedCases)(
  '$name miss exposes its single remote rejection',
  async ({ read }) => {
    const error = new Error('remote unavailable');
    request.mockRejectedValue(error);
    await expect(read()).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  }
);

test('separate uncached calls keep independent remote reads and results', async () => {
  const finish = [];
  let markStarted;
  const started = new Promise(resolve => {
    markStarted = resolve;
  });
  request.mockImplementation(
    () =>
      new Promise(resolve => {
        finish.push(resolve);
        if (finish.length === 2) markStarted();
      })
  );
  const first = getLyric(40);
  const second = getLyric(40);
  // Wait until both external requests have started without settling either.
  await started;
  finish[1]({ lrc: { lyric: 'second' } });
  await expect(second).resolves.toEqual({ lrc: { lyric: 'second' } });
  finish[0]({ lrc: { lyric: 'first' } });
  await expect(first).resolves.toEqual({ lrc: { lyric: 'first' } });
  expect(request).toHaveBeenCalledTimes(2);
  request.mockImplementation(() => new Promise(() => {}));
  await expect(getLyric(40)).resolves.toEqual({ lrc: { lyric: 'first' } });
});

test.each(cachedCases)(
  '$name miss commits data before completing for subsequent cached reads',
  async ({ read, expected }) => {
    request.mockResolvedValue(JSON.parse(JSON.stringify(expected)));
    await expect(read()).resolves.toEqual(expected);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(() => new Promise(() => {}));
    await expect(read()).resolves.toEqual(expected);
    expect(request).toHaveBeenCalledTimes(2);
  }
);
