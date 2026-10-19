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
 * 说明 : 调用此接口 , 传入音乐 id(支持多个 id, 用 , 隔开), 可获得歌曲详情(注意:歌曲封面现在需要通过专辑内容接口获取)
 * @param {string} ids - 音乐 id, 例如 ids=405998841,33894312
 */
export function getTrackDetail(ids) {
  const idsInArray = String(ids).split(',');
  const convert = data => ({
    ...data,
    songs: mapTrackPlayableStatus(data.songs, data.privileges, readIdentity()),
  });
  return readMetadata({
    readCache: async () => {
      const cached = await getTrackDetailFromCache(idsInArray);
      return cached == null ? cached : convert(cached);
    },
    fetchLatest: async () => {
      const data = await request({
        url: '/song/detail',
        method: 'get',
        params: { ids },
      });
      await Promise.all(
        data.songs.map(song =>
          cacheTrackDetail(
            song,
            data.privileges.find(t => t.id === song.id)
          )
        )
      );
      const songs = idsInArray
        .map(id => data.songs.find(song => String(song.id) === id))
        .filter(Boolean);
      return convert({ ...data, songs });
    },
  });
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
 * 新歌速递
 * 说明 : 调用此接口 , 可获取新歌速递
 * @param {number} type - 地区类型 id, 对应以下: 全部:0 华语:7 欧美:96 日本:8 韩国:16
 */
export function topSong(type) {
  return request({
    url: '/top/song',
    method: 'get',
    params: {
      type,
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
