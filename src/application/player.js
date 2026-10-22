import { createLyrics } from '@/lyrics';
import { Howl } from 'howler';
import { personalFM, fmTrash } from '@/api/others';
import {
  getMP3,
  getTrackDetail,
  getLyric,
  getCloudLyric,
  scrobble,
} from '@/api/track';
import { getPlaylistDetail, intelligencePlaylist } from '@/api/playlist';
import { getAlbum } from '@/api/album';
import { getArtist } from '@/api/artist';
import { getTrackCache } from '@/utils/db';
import { trackScrobble, trackUpdateNowPlaying } from '@/api/lastfm';
import { createPlaybackReporting } from './playbackReporting';
import { createPlayerStorage } from './playerStorage';
import { createPlaybackPlatform } from './playbackPlatform';
import { createPlayback } from '@/playback';
import { toggleTrackFavoriteWithFeedback } from '@/utils/libraryOutcome';
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
  getSettings,
  getIdentity,
  storage = localStorage,
  platform: suppliedPlatform,
  platformOptions = {},
  lyricsOptions = {},
  onPlaybackEvent,
  onStateChange,
  onProgress,
  ...overrides
} = {}) {
  const persistence = createPlayerStorage(storage);
  let playback;
  let lyrics;
  let platform = suppliedPlatform;
  let disposed = false;
  const liked = () =>
    store.getters['library/collections'].songs.includes(
      playback.state.currentTrack.id
    );
  const settings = getSettings;
  const ipcRenderer =
    process.env.IS_ELECTRON === true
      ? window.require('electron').ipcRenderer
      : null;
  const reportPlayback = createPlaybackReporting({
    neteaseScrobble: scrobble,
    lastfmScrobble: trackScrobble,
    lastfmNowPlaying: trackUpdateNowPlaying,
    getLastfmAuthorization: () => store.getters['lastfm/authorization'],
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
      const result = await getTrackDetail([id]);
      return result.songs[0];
    },
    personalFM: {
      load: async () => {
        const response = await personalFM();
        return response.data;
      },
      trash: fmTrash,
    },
    resources: createAudioResources({
      cache: getTrackCache(),
      getMP3,
      hasAccount: () => getIdentity().hasAccount,
      isElectron: process.env.IS_ELECTRON === true,
      settings,
      unblock: track => {
        const {
          unmSource,
          unmSearchMode,
          unmEnableFlac,
          unmProxyUri,
          unmJooxCookie,
          unmQQCookie,
          unmYtDlExe,
        } = settings();
        return ipcRenderer.invoke('unblock-music', track, {
          unmSource,
          unmSearchMode,
          unmEnableFlac,
          unmProxyUri,
          unmJooxCookie,
          unmQQCookie,
          unmYtDlExe,
        });
      },
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
      if (!disposed) platform?.publish(state);
      if (onStateChange) onStateChange(state);
    },
    onArchive(archive) {
      if (!disposed) persistence.save(archive);
    },
    onTrackChange(track, duration) {
      if (disposed) return;
      platform?.trackChanged(track, duration);
      lyrics?.setTrack(track);
      if (track) platform?.likedChanged(liked());
    },
    onPlayingChange(playing) {
      if (disposed) return;
      lyrics?.playbackChanged();
      platform?.playingChanged(playing);
    },
    onModesChange(modes) {
      if (!disposed) platform?.modesChanged(modes);
    },
    onProgress(position, detail) {
      if (!disposed) {
        persistence.saveProgress(position);
        lyrics?.position();
        platform?.progress(position, detail);
      }
      if (onProgress) onProgress(position, detail);
    },
    onPlaybackEvent(event) {
      reportPlayback(event);
      if (onPlaybackEvent) onPlaybackEvent(event);
    },
  });
  lyrics = createLyrics({
    playback,
    getIdentity,
    getLyric,
    getCloudLyric,
    ...lyricsOptions,
    onContent: content => platform?.lyricsChanged(content),
    onLine: line => platform?.lineChanged(line),
  });
  const unsubscribe = store.subscribe(mutation => {
    if (mutation.type === 'library/setUser') lyrics.identityReady();
    if (
      mutation.type === 'library/setCollection' &&
      mutation.payload.name === 'songs'
    )
      platform?.likedChanged(liked());
  });
  const player = Object.freeze({
    ...playback,
    lyrics,
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
      unsubscribe();
      lyrics.dispose();
      platform?.dispose();
      playback.dispose();
    },
  });
  if (platform === undefined) {
    platform = createPlaybackPlatform({
      playback: player,
      settings,
      lyrics,
      toggleFavorite: id => toggleTrackFavoriteWithFeedback(store, id),
      onTitle: title => store.commit('updateTitle', title),
      ...platformOptions,
    });
  }
  platform?.publish(playback.state);
  platform?.likedChanged(liked());
  platform?.playingChanged(false);
  platform?.modesChanged(playback.state);
  return player;
}
