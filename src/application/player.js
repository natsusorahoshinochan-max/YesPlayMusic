import { Howl } from 'howler';
import { personalFM, fmTrash } from '@/api/others';
import { getMP3, getTrackDetail } from '@/api/track';
import { getTrackSource, cacheTrackSource } from '@/utils/db';
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

export function createPlayer({ store, ...overrides } = {}) {
  const settings = () => store.getters['preferences/settings'];
  const ipcRenderer =
    process.env.IS_ELECTRON === true
      ? window.require('electron').ipcRenderer
      : null;
  return createPlayback({
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
  });
}
