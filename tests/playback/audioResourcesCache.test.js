/** @jest-environment node */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { createAudioCache } from '@/audioCache';
import { createAudioResources } from '@/playback/audioResources';

test('prefetched audio commits through the production cache and resolves as bytes with provider provenance', async () => {
  const db = new Dexie(`resources-cache-${Math.random()}`);
  db.version(1).stores({ trackSources: '&id, createTime' });
  let downloadComplete;
  const committed = new Promise(resolve => {
    downloadComplete = resolve;
  });
  const cache = createAudioCache({
    db,
    download: async () => new Uint8Array([9, 8, 7]).buffer,
  });
  // A live DB hook observes the transaction completing; storage remains the production cache.
  db.trackSources.hook('creating', function () {
    this.onsuccess = downloadComplete;
  });
  const resources = createAudioResources({
    cache,
    hasAccount: () => true,
    isElectron: true,
    settings: () => ({ automaticallyCacheSongs: true }),
    getMP3: async () => ({ data: [] }),
    unblock: async () => ({ source: 'kuwo', url: 'https://kuwo.cn/audio.mp3' }),
  });
  try {
    await resources.prefetch({
      id: '42',
      name: 'Song',
      ar: [{ name: 'Artist' }],
    });
    await committed;
    expect(await resources.resolve({ id: 42 })).toEqual({
      kind: 'bytes',
      bytes: new Uint8Array([9, 8, 7]).buffer,
      sourceInfo: { from: 'unm:kuwo', bitRate: 128000, cached: true },
    });
    expect(await cache.countDBSize()).toEqual({ bytes: 3, length: 1 });
  } finally {
    await db.delete();
  }
});
