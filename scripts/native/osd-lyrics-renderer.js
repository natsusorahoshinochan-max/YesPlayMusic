import { ipcRenderer } from 'electron';
import { createPlaybackPlatform } from '../../src/application/playbackPlatform';

window.startNativePublication = id => {
  window.nativePlatform?.dispose();
  const track = {
    id,
    name: `native-track-${id}`,
    ar: [{ name: 'native-artist' }],
    al: { name: 'native-album', picUrl: '' },
    dt: 60000,
  };
  window.nativeAcks = [];
  ipcRenderer.removeAllListeners('saveLyricFinished');
  ipcRenderer.on('saveLyricFinished', (_, requestId) => {
    window.nativeAcks.push(requestId);
    ipcRenderer.send('nativeAckObserved', requestId);
  });
  window.nativePlatform = createPlaybackPlatform({
    playback: { position: () => 0 },
    ipc: ipcRenderer,
    settings: () => ({
      enableOsdlyricsSupport: true,
      enableDiscordRichPresence: false,
    }),
    lyrics: {
      state: {
        trackId: id,
        generation: id,
        status: 'ready',
        raw: '[00:00.00]native lyrics',
      },
      subscribe: () => () => {},
    },
    createMpris: true,
    createTouchBar: false,
    createTray: false,
  });
  window.nativePlatform.publish({
    currentTrack: track,
    currentTrackID: id,
    sourceInfo: { id },
    durationSeconds: 60,
    playing: true,
    progress: 0,
    repeatMode: 'off',
    shuffle: false,
  });
};
