import { isCreateMpris, isCreateTray, isMac } from '@/utils/platform';

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
  lyrics,
  setTimeout: schedule = setTimeout,
  clearTimeout: cancel = clearTimeout,
  lyricsWriteTimeout = 5000,
  createTouchBar = isMac,
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
  function cancelLyricsWrite() {
    if (pendingLyrics) cancel(pendingLyrics.timeout);
    pendingLyrics = undefined;
  }
  function finishLyricsWrite(requestId) {
    if (!pendingLyrics || requestId !== pendingLyrics.generation) return;
    const { metadata, generation } = pendingLyrics;
    cancelLyricsWrite();
    if (generation === metadataGeneration) send('metadata', metadata);
  }
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
  listen('play', () => playback.play());
  listen('pause', () => playback.pause());
  listen('toggle', () => playback.toggle());
  listen('next', () => playback.next());
  listen('previous', () => playback.previous());
  listen('increaseVolume', () =>
    playback.setVolume(Math.min(1, playback.state.volume + 0.1))
  );
  listen('decreaseVolume', () =>
    playback.setVolume(Math.max(0, playback.state.volume - 0.1))
  );
  listen('like', () => toggleFavorite(playback.state.currentTrackID));
  listen('setRepeatMode', (_, mode) => playback.setRepeatMode(mode));
  listen('setShuffle', (_, enabled) => playback.setShuffle(enabled));
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
    cancelLyricsWrite();
    if (!createMpris || !ipc) return;
    if (!settings().enableOsdlyricsSupport) {
      send('metadata', metadata);
      return;
    }
    const content = lyrics?.state;
    if (
      !content ||
      content.trackId !== track.id ||
      content.status === 'loading' ||
      content.status === 'idle'
    )
      return;
    pendingLyrics = {
      metadata,
      generation,
      timeout: schedule(
        () => finishLyricsWrite(generation),
        lyricsWriteTimeout
      ),
    };
    send('sendLyrics', { track, lyrics: content.raw, requestId: generation });
  }
  function reconcileMetadata() {
    const state = lastState;
    const key =
      state?.currentTrack?.id && state.sourceInfo
        ? JSON.stringify([
            state.currentTrack,
            lyrics?.state.generation,
            lyrics?.state.status,
          ])
        : undefined;
    if (key === metadataKey) return;
    metadataKey = key;
    if (key) {
      publishMetadata(state.currentTrack, state);
    } else {
      metadataGeneration++;
      cancelLyricsWrite();
    }
  }
  let currentLine;
  const releaseClock = ipc && createTouchBar ? lyrics?.consume() : undefined;
  const unsubscribeLyrics = lyrics?.subscribe(content => {
    if (createTouchBar && content.currentLine !== currentLine) {
      currentLine = content.currentLine;
      send('updateLyric', { lyric: currentLine });
    }
    reconcileMetadata();
  });
  listen('saveLyricFinished', (_, requestId) => finishLyricsWrite(requestId));
  return {
    publish(state, liked = false) {
      if (disposed) return;
      const previous = lastState;
      lastState = state;
      publishedSnapshot = {
        ...state,
        likedCurrentTrack: liked,
        progress: state.progress,
      };
      publicExport.player = publishedSnapshot;
      send('player', publishedSnapshot);
      if (createTray) send('updateTrayLikeState', liked);
      const changedPlayback =
        !previous ||
        previous.playing !== state.playing ||
        previous.currentTrackID !== state.currentTrackID;
      // A metadata-ready target can still be waiting on the old audio handle.
      if (changedPlayback && (!state.playing || state.sourceInfo)) {
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
        discord(state, state.progress);
      }
      if (
        createMpris &&
        (!previous || previous.repeatMode !== state.repeatMode)
      )
        send('switchRepeatMode', state.repeatMode);
      if (createMpris && (!previous || previous.shuffle !== state.shuffle))
        send('switchShuffle', state.shuffle);
      reconcileMetadata();
      updatePosition(state.progress);
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
        if (lastState?.playing && lastState.sourceInfo)
          discord(lastState, position);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      metadataGeneration++;
      unsubscribeLyrics?.();
      releaseClock?.();
      browserWindow.removeEventListener('keydown', keydown);
      cancelLyricsWrite();
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
