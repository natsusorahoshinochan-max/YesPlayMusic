import Vue from 'vue';

const clone = value =>
  value == null ? value : JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const outcome = (status, reason) =>
  reason === undefined ? { status } : { status, reason };

export function createPlayback({
  random = Math.random,
  personalFM,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  getTrack,
  sourceLists,
  resources,
  audio,
  onFeedback = () => {},
  onPlaybackEvent = () => {},
  onStateChange = () => {},
  onArchive = () => {},
  onTrackChange = () => {},
  onPlayingChange = () => {},
  onModesChange = () => {},
  onProgress = () => {},
  observe = Vue.observable,
  setInterval: schedule = setInterval,
  clearInterval: unschedule = clearInterval,
} = {}) {
  let disposed = false;
  let operationId = 0;
  let current = null;
  const preparations = new Set();
  let list = [];
  let index = 0;
  let nextList = [];
  let shuffledOrder = [];
  let shuffledIndex = 0;
  let fmRequest = 0;
  let volumeBeforeMuted = 1;
  const state = {
    currentTrack: { id: 0 },
    playlistSource: {},
    enabled: false,
    playing: false,
    progress: 0,
    currentTrackDuration: 0,
    durationSeconds: 0,
    volume: 1,
    repeatMode: 'off',
    shuffle: false,
    reversed: false,
    isPersonalFM: false,
    personalFMTrack: { id: 0 },
    personalFMNextTrack: { id: 0 },
    personalFMLoading: false,
    personalFMNextLoading: false,
    sourceInfo: null,
  };
  const holder = observe({ snapshot: freeze(clone(state)), upcoming: [] });
  const safe = (receiver, ...values) => {
    try {
      const returned = receiver(...values);
      if (returned && typeof returned.catch === 'function') {
        returned.catch(error => console.debug('[playback receiver]', error));
      }
    } catch (error) {
      console.debug('[playback receiver]', error);
    }
  };
  function publish(semantic = true) {
    holder.snapshot = freeze(clone(state));
    if (semantic) safe(onStateChange, holder.snapshot);
  }
  const save = () => safe(onArchive, playback.archive());
  const modesChanged = () =>
    safe(onModesChange, {
      repeatMode: state.repeatMode,
      shuffle: state.shuffle,
    });
  const valid = context => !disposed && context.id === operationId;
  function feedback(context, result) {
    if (valid(context))
      safe(
        onFeedback,
        freeze({
          ...result,
          operationId: context.id,
          track: clone(state.currentTrack),
        })
      );
    return result;
  }
  function emit(instance, type) {
    // The previous instance remains eligible for its final handoff event even
    // when a newer target owns the selection operation.
    if (!instance || !instance.played || instance.released) return;
    const position =
      type === 'ended'
        ? instance.durationSeconds
        : Math.floor(instance.handle.position());
    if (type !== 'played') {
      if (instance.recorded || position < 1) return;
      instance.recorded = true;
    }
    safe(
      onPlaybackEvent,
      freeze({
        type,
        operationId: instance.operationId,
        track: clone(instance.track),
        source: clone(instance.source),
        position,
        durationSeconds: instance.durationSeconds,
      })
    );
  }
  function release(instance) {
    if (!instance || instance.released) return;
    instance.released = true;
    instance.handle.dispose();
  }
  function stopCurrent(context) {
    if (!valid(context)) return false;
    const previous = current;
    emit(previous, 'before-replace');
    if (!valid(context)) return false;
    release(previous);
    current = null;
    state.playing = false;
    state.sourceInfo = null;
    state.progress = 0;
    safe(onTrackChange, null);
    publish();
    safe(onPlayingChange, false);
    safe(onProgress, 0);
    return true;
  }
  function failSelection(context, reason) {
    if (!stopCurrent(context)) return outcome('superseded');
    return feedback(context, outcome('failed', reason));
  }
  function shuffleQueue(anchor) {
    const order = list.map((_, i) => i).filter(i => i !== anchor);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    shuffledOrder = anchor == null ? order : [anchor, ...order];
    shuffledIndex = 0;
  }
  function nextMain(position, direction = 1) {
    const size = list.length;
    if (!size) return null;
    const target = position + direction * (state.reversed ? -1 : 1);
    if (target >= 0 && target < size) return target;
    return state.repeatMode === 'on' ? (target + size) % size : null;
  }
  function rows(limit) {
    const bounded = Math.max(
      0,
      Math.min(1000, Number.isFinite(limit) ? Math.floor(limit) : 0)
    );
    if (state.isPersonalFM)
      return bounded &&
        state.personalFMNextTrack?.id &&
        state.personalFMNextTrack.id !== state.personalFMTrack?.id
        ? [
            {
              trackId: state.personalFMNextTrack.id,
              group: 'main',
              index: 0,
              personalFM: true,
            },
          ]
        : [];
    const result = nextList.slice(0, bounded).map((trackId, nextIndex) => ({
      trackId,
      group: 'next',
      index: nextIndex,
    }));
    let position = state.shuffle ? shuffledIndex : index;
    while (result.length < bounded) {
      position = nextMain(position);
      if (position == null) break;
      const mainIndex = state.shuffle ? shuffledOrder[position] : position;
      result.push({
        trackId: list[mainIndex],
        group: 'main',
        index: mainIndex,
      });
    }
    return result;
  }
  function queueChanged() {
    holder.upcoming = freeze(rows(1000));
    save();
  }
  async function advance(context, direction = 1, visited = new Set()) {
    if (!valid(context)) return outcome('superseded');
    if (state.isPersonalFM)
      return direction === 1
        ? advanceFM(context, visited)
        : outcome('unavailable', 'fm-previous');
    let id;
    let remaining = list.length + nextList.length;
    do {
      if (remaining-- <= 0) {
        queueChanged();
        publish();
        return outcome('unavailable', 'queue-ended');
      }
      if (direction === 1 && nextList.length) id = nextList.shift();
      else {
        const target = nextMain(
          state.shuffle ? shuffledIndex : index,
          direction
        );
        if (target == null) {
          if (current) current.handle.pause();
          state.playing = false;
          queueChanged();
          publish();
          safe(onPlayingChange, false);
          return outcome('unavailable', 'queue-ended');
        }
        if (state.shuffle) {
          shuffledIndex = target;
          index = shuffledOrder[target];
        } else index = target;
        id = list[index];
      }
    } while (visited.has(id));
    queueChanged();
    publish();
    return select(context, id, { direction, visited });
  }
  async function select(
    context,
    id,
    {
      autoplay = true,
      position = 0,
      direction = 1,
      prefetch = true,
      visited = new Set(),
    } = {}
  ) {
    if (!valid(context)) return outcome('superseded');
    visited.add(id);
    let prepared;
    let preparation;
    try {
      const track = await getTrack(id);
      if (!valid(context)) return outcome('superseded');
      if (!track || track.id == null) throw new Error('invalid-track');
      state.currentTrack = clone(track);
      state.progress = position;
      state.sourceInfo = null;
      state.enabled = true;
      state.durationSeconds = Math.floor((track.dt || 0) / 1000);
      state.currentTrackDuration = Math.max(
        0,
        state.durationSeconds - (state.durationSeconds > 1 ? 1 : 0)
      );
      safe(onTrackChange, null);
      save();
      publish();
      const resource = await resources.resolve(track);
      if (!valid(context)) return outcome('superseded');
      if (!resource) {
        feedback(context, outcome('unavailable', 'no-source'));
        await advance(context, direction, visited);
        return valid(context)
          ? outcome('unavailable', 'no-source')
          : outcome('superseded');
      }
      let instance;
      const pendingEvents = [];
      const event = (type, value) => {
        if (!instance) {
          pendingEvents.push([type, value]);
          return;
        }
        if (!valid(context) || current !== instance || instance.released)
          return;
        if (type === 'play') {
          if (state.playing) return;
          instance.played = true;
          state.playing = true;
          publish();
          safe(onPlayingChange, true);
          emit(instance, 'played');
        } else if (type === 'pause') {
          state.playing = false;
          publish();
          safe(onPlayingChange, false);
        } else if (type === 'end') {
          state.playing = false;
          emit(instance, 'ended');
          publish();
          safe(onPlayingChange, false);
          if (!state.isPersonalFM && state.repeatMode === 'one')
            void select(context, instance.track.id);
          else void advance(context);
        } else {
          void recoverAudio(context, instance.track.id, value, {
            position: instance.handle.position(),
            prefetch: false,
          });
        }
      };
      preparation = new AbortController();
      preparations.add(preparation);
      prepared = await audio.prepare(resource, {
        signal: preparation.signal,
        onPlay: () => event('play'),
        onPause: () => event('pause'),
        onEnd: () => event('end'),
        onError: error => event('error', error),
      });
      preparations.delete(preparation);
      if (!valid(context)) {
        prepared.dispose();
        return outcome('superseded');
      }
      emit(current, 'before-replace');
      release(current);
      instance = {
        operationId: context.id,
        handle: prepared,
        track: clone(track),
        source: clone(state.playlistSource),
        durationSeconds: Math.floor((track.dt || 0) / 1000),
        recorded: false,
        played: false,
        released: false,
      };
      current = instance;
      state.sourceInfo = clone(resource.sourceInfo || null);
      state.playing = false;
      state.progress = position;
      prepared.setVolume(state.volume);
      if (position) prepared.seek(position);
      safe(onTrackChange, freeze(clone(track)), state.durationSeconds);
      publish();
      safe(onPlayingChange, false);
      pendingEvents.forEach(([type, value]) => event(type, value));
      if (autoplay) prepared.play();
      if (prefetch && resources.prefetch) {
        const target = rows(1)[0];
        if (target)
          Promise.resolve()
            .then(() => getTrack(target.trackId))
            .then(nextTrack => valid(context) && resources.prefetch(nextTrack))
            .catch(error => console.debug('[playback prefetch]', error));
      }
      return valid(context) ? outcome('completed') : outcome('superseded');
    } catch (error) {
      preparations.delete(preparation);
      if (prepared && (!current || current.handle !== prepared))
        prepared.dispose();
      if (!valid(context)) return outcome('superseded');
      if (error?.name === 'AudioMediaError')
        return recoverAudio(context, id, error, {
          autoplay,
          position,
          direction,
          prefetch,
          visited,
        });
      return failSelection(context, error);
    }
  }
  async function recoverAudio(context, id, error, options = {}) {
    if (error.code === 3 || error.code === 4) {
      const reason = error.code === 4 ? 'unsupported-format' : 'audio-decode';
      if (error.code === 4) feedback(context, outcome('unavailable', reason));
      await advance(context, options.direction, options.visited);
      return valid(context)
        ? outcome('unavailable', reason)
        : outcome('superseded');
    }
    return select(context, id, options);
  }
  async function loadFM(context) {
    state.personalFMLoading = true;
    publish();
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const tracks = await personalFM.load();
        if (!valid(context)) return [];
        if (tracks?.length) return tracks;
        if (attempt < 5) await delay(1000);
        if (!valid(context)) return [];
      }
      feedback(context, outcome('unavailable', 'fm-empty'));
    } catch (error) {
      return Promise.reject('fm-timeout');
    } finally {
      if (valid(context)) {
        state.personalFMLoading = false;
        publish();
      }
    }
    return [];
  }
  async function loadFMNext(context) {
    const request = ++fmRequest;
    state.personalFMNextLoading = true;
    publish();
    try {
      const tracks = await personalFM.load();
      if (!valid(context) || request !== fmRequest) return;
      state.personalFMNextTrack = clone(tracks?.[0] || { id: 0 });
      queueChanged();
      publish();
      if (
        state.personalFMNextTrack.id &&
        state.personalFMNextTrack.id !== state.personalFMTrack.id &&
        resources.prefetch
      )
        await resources.prefetch(state.personalFMNextTrack);
    } catch (error) {
      if (valid(context) && request === fmRequest)
        console.debug('[personal FM next]', error);
    } finally {
      if (valid(context) && request === fmRequest) {
        state.personalFMNextLoading = false;
        publish();
      }
    }
  }
  async function initializeFM(context) {
    const tracks = await loadFM(context);
    if (!valid(context)) return outcome('superseded');
    if (!tracks.length) return outcome('unavailable', 'fm-empty');
    state.personalFMTrack = clone(tracks[0]);
    state.personalFMNextTrack = clone(tracks[1] || { id: 0 });
    return null;
  }
  async function advanceFM(context, visited = new Set()) {
    try {
      fmRequest++;
      state.personalFMNextLoading = false;
      state.isPersonalFM = true;
      state.playlistSource = { type: 'personalFM', id: 0 };
      queueChanged();
      let target = state.personalFMNextTrack;
      if (!target?.id) {
        const tracks = await loadFM(context);
        if (!valid(context)) return outcome('superseded');
        if (!tracks.length) return outcome('unavailable', 'fm-empty');
        target = tracks[0];
      }
      if (visited.has(target.id)) return outcome('unavailable', 'queue-ended');
      if (target.id === state.personalFMTrack.id)
        return outcome('unavailable', 'fm-same-track');
      state.personalFMTrack = clone(target);
      state.personalFMNextTrack = { id: 0 };
      queueChanged();
      publish();
      const result = await select(context, target.id, { visited });
      if (valid(context)) void loadFMNext(context);
      return result;
    } catch (error) {
      return failSelection(context, error);
    }
  }
  function installQueue(ids, source, startTrackId) {
    list = Array.from(ids);
    index = startTrackId == null ? 0 : Math.max(0, list.indexOf(startTrackId));
    shuffleQueue(startTrackId == null ? null : index);
    if (state.shuffle && list.length) index = shuffledOrder[0];
    state.playlistSource = clone(source);
    state.isPersonalFM = false;
    queueChanged();
    publish();
    return list[index];
  }
  function playSource(
    type,
    id,
    { startTrackId, fresh = false } = {},
    intelligence = false
  ) {
    return runSelection(async context => {
      let ids = await sourceLists[type](id, { fresh });
      if (!valid(context)) return outcome('superseded');
      if (intelligence && ids.length) {
        const seed = ids[Math.floor(Math.random() * ids.length)];
        ids = await sourceLists.intelligence(id, seed);
        if (!valid(context)) return outcome('superseded');
      }
      const first = installQueue(ids, { type, id }, startTrackId);
      return ids.length
        ? select(context, first)
        : feedback(context, outcome('unavailable', 'empty-queue'));
    });
  }
  function runSelection(work) {
    operationId++;
    fmRequest++;
    state.personalFMLoading = false;
    state.personalFMNextLoading = false;
    preparations.forEach(controller => controller.abort());
    preparations.clear();
    const context = { id: operationId };
    if (disposed) return Promise.resolve(outcome('superseded'));
    return Promise.resolve()
      .then(() => (valid(context) ? work(context) : outcome('superseded')))
      .then(result => {
        if (!valid(context)) return outcome('superseded');
        if (
          result.status === 'unavailable' &&
          current &&
          current.operationId !== context.id &&
          !stopCurrent(context)
        )
          return outcome('superseded');
        return result;
      })
      .catch(error =>
        valid(context) ? failSelection(context, error) : outcome('superseded')
      );
  }
  const timer = schedule(() => {
    if (!current || disposed || current.operationId !== operationId) return;
    state.progress = current.handle.position();
    publish(false);
    safe(onProgress, state.progress);
  }, 1000);
  const playback = {
    playPlaylist: (id, options) => playSource('playlist', id, options),
    playAlbum: (id, options) => playSource('album', id, options),
    playArtist: (id, options) => playSource('artist', id, options),
    playIntelligencePlaylist: (id, options) =>
      playSource('playlist', id, options, true),
    get state() {
      return holder.snapshot;
    },
    playTracks(ids, { source = {}, startTrackId } = {}) {
      const copy = Array.from(ids);
      const sourceCopy = clone(source);
      return runSelection(context => {
        const first = installQueue(copy, sourceCopy, startTrackId);
        return list.length
          ? select(context, first)
          : feedback(context, outcome('unavailable', 'empty-queue'));
      });
    },
    playQueuedTrack(
      id,
      {
        group = 'main',
        index: selectedIndex,
        personalFM: fmSelection = false,
      } = {}
    ) {
      return runSelection(context => {
        if (fmSelection)
          return id === state.personalFMNextTrack?.id
            ? advanceFM(context)
            : outcome('unavailable', 'missing-track');
        if (group === 'next') {
          const position =
            selectedIndex == null ? nextList.indexOf(id) : selectedIndex;
          if (position < 0 || nextList[position] !== id)
            return outcome('unavailable', 'missing-track');
          nextList.splice(position, 1);
          state.isPersonalFM = false;
        } else {
          const position =
            selectedIndex == null ? list.indexOf(id) : selectedIndex;
          if (position < 0 || list[position] !== id)
            return outcome('unavailable', 'missing-track');
          state.isPersonalFM = false;
          index = position;
          if (state.shuffle) shuffledIndex = shuffledOrder.indexOf(index);
        }
        queueChanged();
        publish();
        return select(context, id);
      });
    },
    next({ personalFM: forcePersonalFM = false } = {}) {
      if (state.isPersonalFM || forcePersonalFM)
        return state.personalFMLoading
          ? Promise.resolve(outcome('unavailable', 'fm-loading'))
          : runSelection(context => advanceFM(context));
      if (
        !nextList.length &&
        nextMain(state.shuffle ? shuffledIndex : index) == null
      ) {
        playback.pause();
        return Promise.resolve(outcome('unavailable', 'queue-ended'));
      }
      return runSelection(context => advance(context));
    },
    previous() {
      if (state.isPersonalFM)
        return Promise.resolve(outcome('unavailable', 'fm-previous'));
      if (nextMain(state.shuffle ? shuffledIndex : index, -1) == null) {
        playback.pause();
        return Promise.resolve(outcome('unavailable', 'queue-ended'));
      }
      return runSelection(context => advance(context, -1));
    },
    play() {
      if (current && !state.playing) current.handle.play();
    },
    pause() {
      if (current && state.playing) current.handle.pause();
    },
    toggle() {
      return state.playing ? playback.pause() : playback.play();
    },
    seek(seconds) {
      if (!current || !Number.isFinite(seconds)) return;
      current.handle.seek(Math.max(0, seconds));
      state.progress = current.handle.position();
      publish(false);
      safe(onProgress, state.progress, { seeked: true });
    },
    position() {
      return current ? current.handle.position() : 0;
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      state.volume = Math.max(0, Math.min(1, value));
      if (current) current.handle.setVolume(state.volume);
      save();
      publish();
    },
    toggleMute() {
      if (state.volume) {
        volumeBeforeMuted = state.volume;
        playback.setVolume(0);
      } else playback.setVolume(volumeBeforeMuted || 1);
    },
    playPersonalFM() {
      if (
        state.isPersonalFM &&
        state.currentTrack.id === state.personalFMTrack?.id &&
        current &&
        current.operationId === operationId
      ) {
        playback.toggle();
        return Promise.resolve(outcome('completed'));
      }
      return runSelection(async context => {
        state.isPersonalFM = true;
        state.playlistSource = { type: 'personalFM', id: 0 };
        queueChanged();
        if (
          !state.personalFMTrack?.id ||
          !state.personalFMNextTrack?.id ||
          state.personalFMTrack.id === state.personalFMNextTrack.id
        ) {
          const failure = await initializeFM(context);
          if (!valid(context)) return outcome('superseded');
          if (failure) return failure;
        }
        queueChanged();
        publish();
        const result = await select(context, state.personalFMTrack.id);
        if (valid(context) && !state.personalFMNextTrack?.id)
          void loadFMNext(context);
        return result;
      });
    },
    async discardFMTrack() {
      if (state.personalFMLoading) return outcome('unavailable', 'fm-loading');
      let id;
      let context;
      const result = await runSelection(async selectionContext => {
        context = selectionContext;
        if (!state.personalFMTrack?.id) {
          const failure = await initializeFM(context);
          if (!valid(context)) return outcome('superseded');
          if (failure) return failure;
        }
        id = state.personalFMTrack.id;
        return advanceFM(context);
      });
      if (result.status !== 'completed') return result;
      if (!valid(context)) return outcome('superseded');
      try {
        await personalFM.trash(id);
        return valid(context) ? result : outcome('superseded');
      } catch (error) {
        return valid(context)
          ? feedback(context, outcome('failed', error))
          : outcome('superseded');
      }
    },
    setRepeatMode(mode) {
      if (
        state.isPersonalFM ||
        !['off', 'on', 'one'].includes(mode) ||
        state.repeatMode === mode
      )
        return;
      state.repeatMode = mode;
      queueChanged();
      modesChanged();
      publish();
    },
    cycleRepeat() {
      playback.setRepeatMode(
        { off: 'on', on: 'one', one: 'off' }[state.repeatMode]
      );
    },
    setShuffle(enabled) {
      if (state.isPersonalFM || state.shuffle === Boolean(enabled)) return;
      state.shuffle = Boolean(enabled);
      if (state.shuffle) shuffleQueue(list.length ? index : null);
      queueChanged();
      modesChanged();
      publish();
    },
    toggleShuffle() {
      playback.setShuffle(!state.shuffle);
    },
    setReversed(value) {
      if (state.isPersonalFM) return;
      state.reversed = Boolean(value);
      queueChanged();
      publish();
    },
    enqueueNext(id, { playNow = false } = {}) {
      nextList.push(id);
      queueChanged();
      publish();
      return playNow
        ? runSelection(context => {
            state.isPersonalFM = false;
            return advance(context);
          })
        : undefined;
    },
    removeNext(position) {
      if (
        Number.isInteger(position) &&
        position >= 0 &&
        position < nextList.length
      ) {
        nextList.splice(position, 1);
        queueChanged();
        publish();
      }
    },
    clearNext() {
      nextList = [];
      queueChanged();
      publish();
    },
    upcoming(limit = 100) {
      return Object.freeze(
        holder.upcoming.slice(
          0,
          Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
        )
      );
    },
    applyOutputDevice() {
      return current ? current.handle.applyOutputDevice() : Promise.resolve();
    },
    archive() {
      return clone({
        _enabled: state.enabled,
        _repeatMode: state.repeatMode,
        _shuffle: state.shuffle,
        _reversed: state.reversed,
        _volume: state.volume,
        _volumeBeforeMuted: volumeBeforeMuted,
        _list: list,
        _current: index,
        _shuffledList: shuffledOrder.map(i => list[i]),
        _shuffledCurrent: shuffledIndex,
        _playlistSource: state.playlistSource,
        _currentTrack: state.currentTrack,
        _playNextList: nextList,
        _isPersonalFM: state.isPersonalFM,
        _personalFMTrack: state.personalFMTrack,
        _personalFMNextTrack: state.personalFMNextTrack,
      });
    },
    restore(archive, position = 0, { preparePersonalFM = false } = {}) {
      const saved = clone(archive);
      return runSelection(context => {
        list = saved._list || [];
        state.playlistSource = clone(saved._playlistSource || {});
        index = saved._current || 0;
        state.repeatMode = saved._repeatMode || 'off';
        state.shuffle = Boolean(saved._shuffle);
        state.reversed = Boolean(saved._reversed);
        shuffledIndex = saved._shuffledCurrent || 0;
        const used = new Set(state.shuffle ? [index] : []);
        shuffledOrder = (saved._shuffledList || []).map((id, position) => {
          if (state.shuffle && position === shuffledIndex && list[index] === id)
            return index;
          const occurrence = list.findIndex(
            (value, i) => value === id && !used.has(i)
          );
          used.add(occurrence);
          return occurrence;
        });
        if (shuffledOrder.length !== list.length || shuffledOrder.includes(-1))
          shuffleQueue(index);
        shuffledIndex = saved._shuffledCurrent || 0;
        state.isPersonalFM = Boolean(saved._isPersonalFM);
        state.personalFMTrack = clone(saved._personalFMTrack || { id: 0 });
        state.personalFMNextTrack = clone(
          saved._personalFMNextTrack || { id: 0 }
        );
        state.currentTrack = clone(saved._currentTrack || { id: 0 });
        state.enabled = Boolean(saved._enabled);
        state.progress = position;
        nextList = saved._playNextList || [];
        state.volume = saved._volume == null ? 1 : saved._volume;
        volumeBeforeMuted = saved._volumeBeforeMuted || 1;
        queueChanged();
        modesChanged();
        publish();
        if (
          preparePersonalFM &&
          personalFM &&
          (!state.personalFMTrack?.id ||
            !state.personalFMNextTrack?.id ||
            state.personalFMTrack.id === state.personalFMNextTrack.id)
        ) {
          // Initialization belongs to this restore operation, including when
          // ordinary playback or a disabled player is being restored.
          Promise.resolve()
            .then(() => valid(context) && personalFM.load())
            .then(tracks => {
              if (!valid(context) || !tracks?.length) return;
              state.personalFMTrack = clone(tracks[0]);
              state.personalFMNextTrack = clone(tracks[1] || { id: 0 });
              if (state.isPersonalFM) queueChanged();
              else save();
              publish();
            })
            .catch(error => {
              if (valid(context))
                console.debug('[personal FM initialization]', error);
            });
        }
        return saved._enabled && saved._currentTrack?.id
          ? select(context, saved._currentTrack.id, {
              autoplay: false,
              position,
            })
          : outcome('completed');
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      operationId++;
      preparations.forEach(controller => controller.abort());
      preparations.clear();
      unschedule(timer);
      release(current);
      current = null;
      state.playing = false;
      publish();
    },
  };
  return Object.freeze(playback);
}
export default createPlayback;
