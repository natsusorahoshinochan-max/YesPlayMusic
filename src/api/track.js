import { readIdentity } from './readingContext';
import readMetadata from './metadataCache';
import request from '@/utils/request';
import { mapTrackPlayableStatus } from '@/utils/common';
import {
  cacheTrackDetail,
  getTrackDetailFromCache,
  cacheLyric,
  getLyricFromCache,
} from '@/utils/db';

/**
 * 获取音乐 url
 * 说明 : 使用歌单详情接口后 , 能得到的音乐的 id, 但不能得到的音乐 url, 调用此接口, 传入的音乐 id( 可多个 , 用逗号隔开 ), 可以获取对应的音乐的 url,
 * !!!未登录状态返回试听片段(返回字段包含被截取的正常歌曲的开始时间和结束时间)
 * @param {string} id - 音乐的 id，例如 id=405998841,33894312
 */
export function getMP3(id, { quality } = {}) {
  if (quality == null) throw new Error('Audio quality must be provided');
  return request({
    url: '/song/url',
    method: 'get',
    params: {
      id,
      br: quality === 'flac' ? '350000' : quality,
    },
  });
}

/**
 * 获取歌曲详情
 * 说明 : 按传入的音乐 ID 顺序返回可取得的歌曲详情。
 * @param {number[]} ids - 音乐 ID 集合
 */
export async function getTrackDetail(ids, { isCurrent } = {}) {
  const data = await readMetadata({
    readCache: () => getTrackDetailFromCache(ids),
    fetchLatest: async () => {
      const data = await request({
        url: '/song/detail',
        isCurrent,
        method: 'get',
        params: { ids: ids.join(',') },
      });
      await Promise.all(
        data.songs.map(song =>
          cacheTrackDetail(
            song,
            data.privileges.find(t => t.id === song.id)
          )
        )
      );
      return data;
    },
  });
  const songs = ids
    .map(id => data.songs.find(song => song.id === id))
    .filter(Boolean);
  return {
    ...data,
    songs: mapTrackPlayableStatus(songs, data.privileges, readIdentity()),
  };
}

/**
 * 获取歌词
 * 说明 : 调用此接口 , 传入音乐 id 可获得对应音乐的歌词 ( 不需要登录 )
 * @param {number} id - 音乐 id
 */
export function getLyric(id, { isCurrent } = {}) {
  return readMetadata({
    readCache: () => getLyricFromCache(id),
    fetchLatest: async () => {
      const result = await request({
        url: '/lyric',
        isCurrent,
        method: 'get',
        params: { id },
      });
      await cacheLyric(id, result);
      return result;
    },
  });
}

/**
 * 获取云盘歌曲内嵌歌词 * 说明 : 调用此接口 , 传入音乐 id 可获得云盘歌曲的内嵌歌词
 * @param {number} songId - 音乐 id
 * @param {number} userId - 用户 id
 */
export function getCloudLyric(songId, userId, { isCurrent } = {}) {
  const cacheKey = `cloud:${userId}:${songId}`;
  return readMetadata({
    readCache: () => getLyricFromCache(cacheKey),
    fetchLatest: async () => {
      const result = await request({
        url: '/api',
        isCurrent,
        method: 'get',
        params: {
          uri: '/api/cloud/lyric/get',
          data: { songId, userId, lv: '-1', kv: '-1' },
          crypto: 'eapi',
        },
      });
      await cacheLyric(cacheKey, result);
      return result;
    },
  });
}

/**
 * 喜欢音乐
 * 说明 : 调用此接口 , 传入音乐 id, 可喜欢该音乐
 * - id - 歌曲 id
 * - like - 默认为 true 即喜欢 , 若传 false, 则取消喜欢
 * @param {Object} params
 * @param {number} params.id
 * @param {boolean=} [params.like]
 */
export function likeATrack(params) {
  params.timestamp = new Date().getTime();
  return request({
    url: '/like',
    method: 'get',
    params,
  });
}

/**
 * 听歌打卡
 * 说明 : 调用此接口 , 传入音乐 id, 来源 id，歌曲时间 time，更新听歌排行数据
 * - id - 歌曲 id
 * - sourceid - 歌单或专辑 id
 * - time - 歌曲播放时间,单位为秒
 * @param {Object} params
 * @param {number} params.id
 * @param {number} params.sourceid
 * @param {number=} params.time
 */
export function scrobble(params) {
  params.timestamp = new Date().getTime();
  return request({
    url: '/scrobble',
    method: 'get',
    params,
  });
}
