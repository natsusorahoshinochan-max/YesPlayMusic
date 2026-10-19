import { isCreateMpris, isCreateTray } from '@/utils/platform';

export function createPlaybackPlatform({
  playback,
  ipc = process.env.IS_ELECTRON === true
    ? window.require('electron').ipcRenderer
    : null,
  navigator: browserNavigator = navigator,
  window: browserWindow = window,
  document: browserDocument = document,
  MediaMetadata = browserWindow.MediaMetadata,
  settings = () => ({}),
  toggleFavorite = () => {},
  onTitle = () => {},
  getLyric = async () => ({}),
  createTray = isCreateTray,
  createMpris = isCreateMpris,
} = {}) {
  let disposed = false;
  const session = browserNavigator.mediaSession;
  const listeners = [];
  let lastState;
  let publishedSnapshot;
  let metadataKey;
  let metadataGeneration = 0;
  let pendingLyrics;
  browserWindow.yesplaymusic = browserWindow.yesplaymusic || {};
  const publicExport = browserWindow.yesplaymusic;
  const send = (channel, payload) => {
    if (!disposed) ipc?.send(channel, payload);
  };
  function listen(channel, handler) {
    if (!ipc) return;
    ipc.on(channel, handler);
    listeners.push([channel, handler]);
  }
  const controls = {
    play: () => playback.play(),
    pause: () => playback.pause(),
    stop: () => playback.pause(),
    previoustrack: () => playback.previous(),
    nexttrack: () => playback.next(),
    seekto: event => playback.seek(event.seekTime),
    seekbackward: event =>
      playback.seek(
        Math.max(0, playback.position() - (event.seekOffset || 10))
      ),
    seekforward: event =>
      playback.seek(playback.position() + (event.seekOffset || 10)),
  };
  const registeredActions = [];
  Object.entries(controls).forEach(([action, handler]) => {
    if (!session) return;
    try {
      session.setActionHandler(action, handler);
      registeredActions.push(action);
    } catch {
      /* Unsupported browser action. */
    }
  });
  const mediaKeys = {
    MediaPlayPause: () => playback.toggle(),
    MediaStop: () => playback.pause(),
    MediaTrackNext: () => playback.next(),
    MediaTrackPrevious: () => playback.previous(),
  };
  const keydown = event => {
    const action = mediaKeys[event.code];
    if (action) {
      event.preventDefault();
      action();
    }
  };
  browserWindow.addEventListener('keydown', keydown);
  listen('play', () => playback.toggle());
  listen('next', () => playback.next());
  listen('previous', () => playback.previous());
  listen('increaseVolume', () =>
    playback.setVolume(Math.min(1, playback.state.volume + 0.1))
  );
  listen('decreaseVolume', () =>
    playback.setVolume(Math.max(0, playback.state.volume - 0.1))
  );
  listen('like', () => toggleFavorite(playback.state.currentTrackID));
  listen('repeat', () => playback.cycleRepeat());
  listen('shuffle', () => playback.toggleShuffle());
  listen('setPosition', (_, position) => playback.seek(position));
  function updatePosition(position) {
    const duration = lastState?.durationSeconds;
    if (session?.setPositionState && duration > 0) {
      session.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(duration, Math.max(0, position)),
      });
    }
  }
  function discord(state, position = playback.position()) {
    if (
      settings().enableDiscordRichPresence === false ||
      !state.currentTrack?.id
    )
      return;
    send(
      state.playing ? 'playDiscordPresence' : 'pauseDiscordPresence',
      state.playing
        ? {
            ...state.currentTrack,
            dt: Math.max(0, state.currentTrack.dt - position * 1000),
          }
        : state.currentTrack
    );
  }
  function publishMetadata(track, state) {
    const metadata = {
      title: track.name,
      artist: (track.ar || []).map(artist => artist.name).join(','),
      album: track.al?.name || '',
      artwork: [224, 512].map(size => ({
        src: `${track.al?.picUrl || ''}?param=${size}y${size}`,
        type: 'image/jpg',
        sizes: `${size}x${size}`,
      })),
      length: state.durationSeconds,
      trackId: state.currentTrackID,
      url: '/trackid/' + track.id,
    };
    if (session && MediaMetadata)
      session.metadata = new MediaMetadata(metadata);
    const generation = ++metadataGeneration;
    pendingLyrics = undefined;
    if (!createMpris || !ipc) return;
    if (!settings().enableOsdlyricsSupport) {
      send('metadata', metadata);
      return;
    }
    Promise.resolve()
      .then(() => getLyric(track.id))
      .then(result => {
        if (disposed || generation !== metadataGeneration) return;
        if (!result?.lrc?.lyric) {
          send('metadata', metadata);
          return;
        }
        pendingLyrics = { metadata, generation };
        send('sendLyrics', {
          track,
          lyrics: result.lrc.lyric,
          requestId: generation,
        });
      })
      .catch(() => {
        if (!disposed && generation === metadataGeneration)
          send('metadata', metadata);
      });
  }
  listen('saveLyricFinished', (_, requestId) => {
    if (
      !pendingLyrics ||
      (requestId !== undefined && requestId !== pendingLyrics.generation)
    )
      return;
    const { metadata, generation } = pendingLyrics;
    pendingLyrics = undefined;
    if (generation === metadataGeneration) send('metadata', metadata);
  });
  return {
    publish(state, liked = false) {
      if (disposed) return;
      const previous = lastState;
      lastState = state;
      publishedSnapshot = {
        ...state,
        likedCurrentTrack: liked,
        progress: playback.position(),
      };
      publicExport.player = publishedSnapshot;
      send('player', publishedSnapshot);
      if (createTray) send('updateTrayLikeState', liked);
      const changedPlayback =
        !previous ||
        previous.playing !== state.playing ||
        previous.currentTrackID !== state.currentTrackID;
      if (changedPlayback) {
        const track = state.currentTrack;
        const title =
          state.playing && track?.id
            ? `${track.name} · ${track.ar?.[0]?.name || ''} - YesPlayMusic`
            : 'YesPlayMusic';
        browserDocument.title = title;
        onTitle(title);
        if (createTray) {
          send('updateTrayTooltip', title);
          send('updateTrayPlayState', state.playing);
        }
        if (session)
          session.playbackState = state.playing ? 'playing' : 'paused';
        discord(state);
      }
      if (
        createMpris &&
        (!previous || previous.repeatMode !== state.repeatMode)
      )
        send('switchRepeatMode', state.repeatMode);
      if (createMpris && (!previous || previous.shuffle !== state.shuffle))
        send('switchShuffle', state.shuffle);
      if (state.currentTrack?.id) {
        const key = JSON.stringify(state.currentTrack);
        if (key !== metadataKey) {
          metadataKey = key;
          publishMetadata(state.currentTrack, state);
        }
      }
      updatePosition(playback.position());
    },
    progress(position, detail = {}) {
      if (disposed) return;
      if (publishedSnapshot) {
        publishedSnapshot = { ...publishedSnapshot, progress: position };
        publicExport.player = publishedSnapshot;
      }
      if (createMpris) send('playerCurrentTrackTime', position);
      updatePosition(position);
      if (detail.seeked) {
        send('seeked', position);
        if (lastState?.playing) discord(lastState, position);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      metadataGeneration++;
      browserWindow.removeEventListener('keydown', keydown);
      pendingLyrics = undefined;
      if (publicExport.player === publishedSnapshot) delete publicExport.player;
      listeners.forEach(([channel, handler]) =>
        ipc.removeListener(channel, handler)
      );
      registeredActions.forEach(action =>
        session.setActionHandler(action, null)
      );
      if (session) {
        session.metadata = null;
        session.playbackState = 'none';
      }
    },
  };
}
export default createPlaybackPlatform;
