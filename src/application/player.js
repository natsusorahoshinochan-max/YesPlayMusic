import { Howl } from 'howler';
import { getMP3, getTrackDetail, scrobble } from '@/api/track';
import { getTrackSource, cacheTrackSource } from '@/utils/db';
import { trackScrobble, trackUpdateNowPlaying } from '@/api/lastfm';
import { createPlaybackReporting } from './playbackReporting';
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
    else if (event.status === 'failed') notify('播放失败，请稍后重试');
  };
}

export function createPlayer({ store, onPlaybackEvent, ...overrides } = {}) {
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
  return createPlayback({
    getTrack: async id => {
      const result = await getTrackDetail(id);
      return result?.songs?.find(track => String(track.id) === String(id));
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
    onPlaybackEvent(event) {
      reportPlayback(event);
      if (onPlaybackEvent) onPlaybackEvent(event);
    },
  });
}
