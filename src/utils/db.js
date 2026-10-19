import axios from 'axios';
import Dexie from 'dexie';
import store from '@/store';
import { createAudioCache } from '@/audioCache';
// import pkg from "../../package.json";

const db = new Dexie('yesplaymusic');

db.version(4).stores({
  trackDetail: '&id, updateTime',
  lyric: '&id, updateTime',
  album: '&id, updateTime',
});

db.version(3)
  .stores({
    trackSources: '&id, createTime',
  })
  .upgrade(tx =>
    tx
      .table('trackSources')
      .toCollection()
      .modify(
        track => !track.createTime && (track.createTime = new Date().getTime())
      )
  );

db.version(1).stores({
  trackSources: '&id',
});

const audioCache = createAudioCache({
  db,
  download: url =>
    axios
      .get(url, { responseType: 'arraybuffer' })
      .then(response => response.data),
  getLimitBytes: () => {
    const limit = store.getters['preferences/settings'].cacheLimit;
    return limit === false ? false : limit * Math.pow(1024, 2);
  },
});

export function initializeTrackCache() {
  if (!process.env.IS_ELECTRON) return Promise.resolve();
  return audioCache.initializeTrackCache();
}

export function cacheTrackSource(track, url, bitRate, from = 'netease') {
  if (!process.env.IS_ELECTRON) return Promise.resolve();
  const cover = track.al?.picUrl?.replace(/^http:/, 'https:');
  if (cover) {
    for (const size of [512, 224, 1024]) {
      axios.get(`${cover}?param=${size}y${size}`).catch(error => {
        console.debug('[audio cache] cover download failed', error);
      });
    }
  }
  return audioCache.cacheTrackSource(track, url, bitRate, from);
}

export const getTrackSource = audioCache.getTrackSource;
export const countDBSize = audioCache.countDBSize;
export const clearDB = audioCache.clearDB;

export function cacheTrackDetail(track, privileges) {
  db.trackDetail.put({
    id: track.id,
    detail: track,
    privileges: privileges,
    updateTime: new Date().getTime(),
  });
}

export function getTrackDetailFromCache(ids) {
  return db.trackDetail
    .filter(track => {
      return ids.includes(String(track.id));
    })
    .toArray()
    .then(tracks => {
      const result = { songs: [], privileges: [] };
      ids.map(id => {
        const one = tracks.find(t => String(t.id) === id);
        result.songs.push(one?.detail);
        result.privileges.push(one?.privileges);
      });
      if (result.songs.includes(undefined)) {
        return undefined;
      }
      return result;
    });
}

export function cacheLyric(id, lyrics) {
  db.lyric.put({
    id,
    lyrics,
    updateTime: new Date().getTime(),
  });
}

export function getLyricFromCache(id) {
  return db.lyric.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.lyrics;
  });
}

export function cacheAlbum(id, album) {
  db.album.put({
    id: Number(id),
    album,
    updateTime: new Date().getTime(),
  });
}

export function getAlbumFromCache(id) {
  return db.album.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.album;
  });
}
