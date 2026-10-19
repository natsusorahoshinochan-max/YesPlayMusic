import axios from 'axios';
import Dexie from 'dexie';
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

let trackCache;

export function getTrackCache() {
  if (!trackCache) throw new Error('Music data has not been configured');
  return trackCache;
}

export function configureTrackCache({
  getLimitBytes,
  isElectron = Boolean(process.env.IS_ELECTRON),
  download = url =>
    axios
      .get(url, { responseType: 'arraybuffer' })
      .then(response => response.data),
  downloadCover = url => axios.get(url),
}) {
  const cache = createAudioCache({ db, download, getLimitBytes });
  trackCache = {
    ...cache,
    initializeTrackCache() {
      return isElectron ? cache.initializeTrackCache() : Promise.resolve();
    },
    cacheTrackSource(track, url, bitRate, from = 'netease') {
      if (!isElectron) return Promise.resolve();
      const cover = track.al?.picUrl?.replace(/^http:/, 'https:');
      if (cover) {
        for (const size of [512, 224, 1024]) {
          Promise.resolve()
            .then(() => downloadCover(`${cover}?param=${size}y${size}`))
            .catch(error => {
              console.debug('[audio cache] cover download failed', error);
            });
        }
      }
      return cache.cacheTrackSource(track, url, bitRate, from);
    },
  };
  return trackCache;
}

export function cacheTrackDetail(track, privileges) {
  return db.trackDetail.put({
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
  return db.lyric.put({
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
  return db.album.put({
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
