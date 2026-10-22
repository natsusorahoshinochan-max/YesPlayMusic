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
  let track;
  let playing = false;
  let liked = false;
  let metadata;
  let publishedSnapshot;
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
      playback.seek(playback.position() - (event.seekOffset || 10)),
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
    playback.setVolume(playback.state.volume + 0.1)
  );
  listen('decreaseVolume', () =>
    playback.setVolume(playback.state.volume - 0.1)
  );
  listen('like', () => toggleFavorite(playback.state.currentTrackID));
  listen('setRepeatMode', (_, mode) => playback.setRepeatMode(mode));
  listen('setShuffle', (_, enabled) => playback.setShuffle(enabled));
  listen('repeat', () => playback.cycleRepeat());
  listen('shuffle', () => playback.toggleShuffle());
  listen('setPosition', (_, position) => playback.seek(position));
  function updatePosition(position) {
    const duration = metadata?.length;
    if (session?.setPositionState && duration > 0) {
      session.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(duration, Math.max(0, position)),
      });
    }
  }
  function discord(position = playback.position()) {
    if (settings().enableDiscordRichPresence === false || !track) return;
    send(
      playing ? 'playDiscordPresence' : 'pauseDiscordPresence',
      playing
        ? { ...track, dt: Math.max(0, track.dt - position * 1000) }
        : track
    );
  }
  const sendPlayer = () =>
    send('player', { playing, likedCurrentTrack: liked });
  const releaseClock = ipc && createTouchBar ? lyrics.consume() : undefined;
  listen('saveLyricFinished', (_, requestId) => finishLyricsWrite(requestId));
  return {
    publish(state) {
      if (disposed) return;
      publishedSnapshot = { ...state, likedCurrentTrack: liked };
      publicExport.player = publishedSnapshot;
    },
    trackChanged(next, duration) {
      metadataGeneration++;
      cancelLyricsWrite();
      if (!next) return;
      track = next;
      metadata = {
        title: track.name,
        artist: (track.ar || []).map(artist => artist.name).join(','),
        album: track.al?.name || '',
        artwork: [224, 512].map(size => ({
          src: `${track.al?.picUrl || ''}?param=${size}y${size}`,
          type: 'image/jpg',
          sizes: `${size}x${size}`,
        })),
        length: duration,
        trackId: track.id,
        url: '/trackid/' + track.id,
      };
      if (session && MediaMetadata)
        session.metadata = new MediaMetadata(metadata);
      if (createMpris && !settings().enableOsdlyricsSupport)
        send('metadata', metadata);
    },
    lyricsChanged(content) {
      const generation = ++metadataGeneration;
      cancelLyricsWrite();
      if (
        !createMpris ||
        !ipc ||
        !settings().enableOsdlyricsSupport ||
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
    },
    lineChanged(line) {
      if (createTouchBar) send('updateLyric', { lyric: line });
    },
    playingChanged(value) {
      if (disposed) return;
      playing = value;
      const title =
        playing && track
          ? `${track.name} · ${track.ar?.[0]?.name || ''} - YesPlayMusic`
          : 'YesPlayMusic';
      browserDocument.title = title;
      onTitle(title);
      sendPlayer();
      if (createTray) {
        send('updateTrayTooltip', title);
        send('updateTrayPlayState', playing);
      }
      if (session) session.playbackState = playing ? 'playing' : 'paused';
      discord();
      updatePosition(playback.position());
    },
    likedChanged(value) {
      liked = value;
      publishedSnapshot = { ...publishedSnapshot, likedCurrentTrack: liked };
      publicExport.player = publishedSnapshot;
      sendPlayer();
      if (createTray) send('updateTrayLikeState', liked);
    },
    modesChanged({ repeatMode, shuffle }) {
      if (!createMpris) return;
      send('switchRepeatMode', repeatMode);
      send('switchShuffle', shuffle);
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
        if (playing) discord(position);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      metadataGeneration++;
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
