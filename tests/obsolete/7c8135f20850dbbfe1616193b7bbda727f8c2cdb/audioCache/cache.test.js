/** @jest-environment node */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { createAudioCache } from '@/audioCache';

let db;
let cache;
beforeEach(() => {
  db = new Dexie(`audio-cache-${Math.random()}`);
  db.version(1).stores({ trackSources: '&id, createTime', lyric: '&id' });
  cache = createAudioCache({
    db,
    download: async size => new ArrayBuffer(size),
  });
});
afterEach(() => db.delete());
const track = id => ({ id, name: `Track ${id}`, ar: [{ name: 'Artist' }] });

test('download completes only after the audio is readable and counted', async () => {
  await cache.cacheTrackSource(track(1), 12, 320000);
  expect((await cache.getTrackSource(1)).source.byteLength).toBe(12);
  expect(await cache.countDBSize()).toEqual({ bytes: 12, length: 1 });
});

test('overwrites and concurrent commits account for byte differences before eviction', async () => {
  cache = createAudioCache({
    db,
    download: async size => new ArrayBuffer(size),
    getLimitBytes: () => 15,
  });
  await cache.cacheTrackSource(track(1), 10, 320000);
  await cache.cacheTrackSource(track(1), 4, 320000);
  await Promise.all([
    cache.cacheTrackSource(track(2), 5, 320000),
    cache.cacheTrackSource(track(3), 6, 320000),
  ]);
  expect(await cache.countDBSize()).toEqual({ bytes: 15, length: 3 });
  await cache.cacheTrackSource(track(4), 8, 320000);
  expect(await cache.getTrackSource(1)).toBeNull();
  expect(await cache.getTrackSource(2)).toBeNull();
  expect(await cache.countDBSize()).toEqual({ bytes: 14, length: 2 });
});

test('a failed transaction rolls back audio and capacity and permits the next commit', async () => {
  cache = createAudioCache({
    db,
    download: async size => new ArrayBuffer(size),
    getLimitBytes: () => 10,
  });
  await cache.cacheTrackSource(track(1), 4, 320000);
  await cache.cacheTrackSource(track(2), 5, 320000);
  const rejectDeletion = () => {
    throw new Error('disk failure');
  };
  db.trackSources.hook('deleting', rejectDeletion);
  await expect(cache.cacheTrackSource(track(3), 6, 320000)).rejects.toThrow(
    'disk failure'
  );
  db.trackSources.hook('deleting').unsubscribe(rejectDeletion);
  expect(await cache.getTrackSource(3)).toBeNull();
  expect((await cache.getTrackSource(1)).source.byteLength).toBe(4);
  expect(await cache.countDBSize()).toEqual({ bytes: 9, length: 2 });
  await cache.cacheTrackSource(track(4), 3, 320000);
  expect(await cache.getTrackSource(1)).toBeNull();
  expect(await cache.countDBSize()).toEqual({ bytes: 8, length: 2 });
});

test('initialization evicts persisted audio before queued writes and capacity reads', async () => {
  await cache.cacheTrackSource(track(1), 7, 320000);
  await cache.cacheTrackSource(track(2), 4, 320000);
  cache = createAudioCache({
    db,
    download: async size => new ArrayBuffer(size),
    getLimitBytes: () => 10,
  });
  const initialized = cache.initializeTrackCache();
  const write = cache.cacheTrackSource(track(3), 5, 320000);
  await initialized;
  await write;
  expect(await cache.getTrackSource(1)).toBeNull();
  expect(await cache.countDBSize()).toEqual({ bytes: 9, length: 2 });
});

test('clear completes all target tables and capacity while pending downloads commit later', async () => {
  let finishDownload;
  const download = jest.fn(size =>
    size === 'pending'
      ? new Promise(resolve => {
          finishDownload = resolve;
        })
      : Promise.resolve(new ArrayBuffer(size))
  );
  cache = createAudioCache({ db, download });
  await cache.cacheTrackSource(track(1), 7, 320000);
  await db.lyric.put({ id: 1, lyrics: 'cached lyric' });
  const pending = cache.cacheTrackSource(track(2), 'pending', 320000);
  expect(download).toHaveBeenCalledTimes(2);
  await cache.clearDB();
  expect(await cache.getTrackSource(1)).toBeNull();
  expect(await db.lyric.get(1)).toBeUndefined();
  expect(await cache.countDBSize()).toEqual({ bytes: 0, length: 0 });
  finishDownload(new ArrayBuffer(9));
  await pending;
  expect(await cache.countDBSize()).toEqual({ bytes: 9, length: 1 });
});

test('downloads overlap and commit in completion order while queries and clear retain their order', async () => {
  const downloads = {};
  cache = createAudioCache({
    db,
    download: url =>
      new Promise(resolve => {
        downloads[url] = resolve;
      }),
  });
  const earlier = cache.cacheTrackSource(track(1), 'earlier', 320000);
  const later = cache.cacheTrackSource(track(1), 'later', 128000);
  expect(Object.keys(downloads)).toEqual(['earlier', 'later']);
  downloads.later(new ArrayBuffer(8));
  await later;
  const beforeClear = cache.countDBSize();
  const clear = cache.clearDB();
  const afterClear = cache.countDBSize();
  const initialize = cache.initializeTrackCache();
  expect(await beforeClear).toEqual({ bytes: 8, length: 1 });
  await clear;
  expect(await afterClear).toEqual({ bytes: 0, length: 0 });
  downloads.earlier(new ArrayBuffer(5));
  await Promise.all([initialize, earlier]);
  expect((await cache.getTrackSource(1)).bitRate).toBe(320000);
  expect(await cache.countDBSize()).toEqual({ bytes: 5, length: 1 });
});

test('overwriting refreshes write time and evicts the oldest remaining write', async () => {
  let now = 10;
  jest.spyOn(Date, 'now').mockImplementation(() => now++);
  cache = createAudioCache({
    db,
    download: async size => new ArrayBuffer(size),
    getLimitBytes: () => 10,
  });
  await cache.cacheTrackSource(track(1), 4, 320000);
  await cache.cacheTrackSource(track(2), 4, 320000);
  await cache.cacheTrackSource(track(1), 4, 320000);
  await cache.cacheTrackSource(track(3), 4, 320000);
  expect(await cache.getTrackSource(2)).toBeNull();
  expect((await cache.getTrackSource(1)).source.byteLength).toBe(4);
  expect(await cache.countDBSize()).toEqual({ bytes: 8, length: 2 });
});

test('failed clear rolls back every table and retains capacity for later operations', async () => {
  await cache.cacheTrackSource(track(1), 7, 320000);
  await db.lyric.put({ id: 1, lyrics: 'retained lyric' });
  const rejectDeletion = () => {
    throw new Error('cannot clear lyrics');
  };
  db.lyric.hook('deleting', rejectDeletion);
  await expect(cache.clearDB()).rejects.toThrow('cannot clear lyrics');
  db.lyric.hook('deleting').unsubscribe(rejectDeletion);
  expect((await cache.getTrackSource(1)).source.byteLength).toBe(7);
  expect((await db.lyric.get(1)).lyrics).toBe('retained lyric');
  expect(await cache.countDBSize()).toEqual({ bytes: 7, length: 1 });
  await cache.clearDB();
  expect(await cache.countDBSize()).toEqual({ bytes: 0, length: 0 });
});
