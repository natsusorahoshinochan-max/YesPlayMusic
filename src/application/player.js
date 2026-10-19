import { Howl } from 'howler';
import { personalFM, fmTrash } from '@/api/others';
import { getMP3, getTrackDetail, getLyric, scrobble } from '@/api/track';
import { getPlaylistDetail, intelligencePlaylist } from '@/api/playlist';
import { getAlbum } from '@/api/album';
import { getArtist } from '@/api/artist';
import { getTrackSource, cacheTrackSource } from '@/utils/db';
import { trackScrobble, trackUpdateNowPlaying } from '@/api/lastfm';
import { createPlaybackReporting } from './playbackReporting';
import { createPlayerStorage } from './playerStorage';
import { createPlaybackPlatform } from './playbackPlatform';
import { createPlayback } from '@/playback';
import { createAudioResources } from '@/playback/audioResources';
import { createAudioAdapter } from '@/playback/audioAdapter';

export function createPlaybackFeedback({ notify }) {
  return event => {
    if (event.status === 'superseded' || event.status === 'completed') return;
    if (event.reason === 'unsupported-format')
      notify('无法播放: 不支持的音频格式');
    else if (event.reason === 'no-source')
      notify(`无法播放 ${event.track?.name || '当前歌曲'}`);
    else if (event.reason === 'fm-empty')
      notify('获取私人FM数据时重试次数过多，请手动切换下一首');
    else if (event.reason === 'fm-timeout') notify('personal fm timeout');
    else if (event.status === 'failed') notify('播放失败，请稍后重试');
  };
}

export function createPlayer({
  store,
  storage = localStorage,
  platform: suppliedPlatform,
  platformOptions = {},
  onPlaybackEvent,
  onStateChange,
  onProgress,
  ...overrides
} = {}) {
  const persistence = createPlayerStorage(storage);
  let playback;
  let platform = suppliedPlatform;
  let disposed = false;
  const liked = () =>
    (
      store.getters['library/collections']?.songs ||
      store.state.library?.collections?.songs ||
      []
    ).includes(playback.state.currentTrackID);
  const publish = () => platform?.publish(playback.state, liked());
  const settings = () => store.getters['preferences/settings'];
  const ipcRenderer =
    process.env.IS_ELECTRON === true
      ? window.require('electron').ipcRenderer
      : null;
  const reportPlayback = createPlaybackReporting({
    neteaseScrobble: scrobble,
    lastfmScrobble: trackScrobble,
    lastfmNowPlaying: trackUpdateNowPlaying,
    getLastfmKey: () => store.state.lastfm?.key,
  });
  playback = createPlayback({
    sourceLists: {
      playlist: async (id, { fresh }) => {
        const result = await getPlaylistDetail(id, fresh);
        return result.playlist.trackIds.map(track => track.id);
      },
      album: async id => {
        const result = await getAlbum(id);
        return result.songs.map(track => track.id);
      },
      artist: async id => {
        const result = await getArtist(id);
        return result.hotSongs.map(track => track.id);
      },
      intelligence: async (id, seedTrackId) => {
        const result = await intelligencePlaylist({ id: seedTrackId, pid: id });
        return result.data.map(track => track.id);
      },
    },
    getTrack: async id => {
      const result = await getTrackDetail(id);
      return result?.songs?.find(track => String(track.id) === String(id));
    },
    personalFM: {
      load: async () => {
        const response = await personalFM();
        if (!Array.isArray(response?.data))
          throw new Error('invalid-fm-response');
        return response.data;
      },
      trash: fmTrash,
    },
    resources: createAudioResources({
      cache: { getTrackSource, cacheTrackSource },
      getMP3,
      hasAccount: () => store.getters['session/hasAccount'],
      isElectron: process.env.IS_ELECTRON === true,
      settings,
      unblock: (...args) => ipcRenderer.invoke(...args),
      onBackgroundError: error =>
        console.debug('[audio cache] background write failed', error),
    }),
    audio: createAudioAdapter({
      Howl,
      outputDevice: () => settings().outputDevice,
    }),
    onFeedback: createPlaybackFeedback({
      notify: message => store.dispatch('showToast', message),
    }),
    ...overrides,
    onStateChange(state) {
      if (!disposed) {
        persistence.save(playback.archive());
        publish();
      }
      if (onStateChange) onStateChange(state);
    },
    onProgress(position, detail) {
      if (!disposed) {
        persistence.saveProgress(position);
        platform?.progress(position, detail);
      }
      if (onProgress) onProgress(position, detail);
    },
    onPlaybackEvent(event) {
      reportPlayback(event);
      if (onPlaybackEvent) onPlaybackEvent(event);
    },
  });
  const unsubscribe = store.subscribe?.(mutation => {
    if (mutation.type.startsWith('library/')) publish();
  });
  const player = Object.freeze({
    ...playback,
    get state() {
      return playback.state;
    },
    restoreSaved() {
      return playback.restore(
        persistence.initial.archive,
        persistence.initial.position,
        {
          preparePersonalFM: true,
        }
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      platform?.dispose();
      playback.dispose();
    },
  });
  if (platform === undefined) {
    platform = createPlaybackPlatform({
      playback: player,
      settings,
      getLyric,
      toggleFavorite: id => store.dispatch('library/toggleTrackFavorite', id),
      onTitle: title => store.commit?.('updateTitle', title),
      ...platformOptions,
    });
  }
  publish();
  return player;
}
