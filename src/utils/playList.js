import store from '@/store';
import router from '../router';
import {
  recommendPlaylist,
  dailyRecommendPlaylist,
  getPlaylistDetail,
} from '@/api/playlist';

export function hasListSource() {
  return (
    !store.state.player.state.isPersonalFM &&
    store.state.player.state.playlistSource.id !== 0
  );
}

export function goToListSource() {
  router.push({ path: getListSourcePath() });
}

export function getListSourcePath() {
  if (
    store.state.player.state.playlistSource.id ===
    store.getters['library/likedSongPlaylistID']
  ) {
    return '/library/liked-songs';
  } else if (store.state.player.state.playlistSource.type === 'url') {
    return store.state.player.state.playlistSource.id;
  } else if (store.state.player.state.playlistSource.type === 'cloudDisk') {
    return '/library';
  } else {
    return `/${store.state.player.state.playlistSource.type}/${store.state.player.state.playlistSource.id}`;
  }
}

export async function getRecommendPlayList(limit, removePrivateRecommand) {
  if (store.getters['session/hasAccount']) {
    const playlists = await Promise.all([
      dailyRecommendPlaylist(),
      recommendPlaylist({ limit }),
    ]);
    if (
      !Array.isArray(playlists[0]?.recommend) ||
      !Array.isArray(playlists[1]?.result)
    )
      throw new Error('推荐歌单读取失败');
    let recommend = playlists[0].recommend;
    if (recommend.length) {
      if (removePrivateRecommand) recommend = recommend.slice(1);
      await replaceRecommendResult(recommend);
    }
    return recommend.concat(playlists[1].result).slice(0, limit);
  } else {
    const response = await recommendPlaylist({ limit });
    if (!Array.isArray(response?.result)) throw new Error('推荐歌单读取失败');
    return response.result;
  }
}

async function replaceRecommendResult(recommend) {
  for (let r of recommend) {
    if (specialPlaylist.indexOf(r.id) > -1) {
      const data = await getPlaylistDetail(r.id, true);
      const playlist = data.playlist;
      if (playlist) {
        r.name = playlist.name;
        r.picUrl = playlist.coverImgUrl;
      }
    }
  }
}

const specialPlaylist = [3136952023, 2829883282, 2829816518, 2829896389];
