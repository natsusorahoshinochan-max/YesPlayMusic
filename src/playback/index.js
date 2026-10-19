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
  getTrack,
  resources,
  audio,
  onFeedback = () => {},
  onPlaybackEvent = () => {},
  onStateChange = () => {},
  onProgress = () => {},
  observe = Vue.observable,
  setInterval: schedule = setInterval,
  clearInterval: unschedule = clearInterval,
} = {}) {
  let disposed = false;
  let operationId = 0;
  let instanceId = 0;
  let current = null;
  const preparations = new Set();
  let list = [];
  let index = 0;
  let nextList = [];
  let volumeBeforeMuted = 1;
  const state = {
    currentTrack: { id: 0 },
    currentTrackID: 0,
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
  const holder = observe({ snapshot: freeze(clone(state)) });
  const safe = (receiver, value) => {
    try {
      receiver(value);
    } catch (error) {
      console.debug('[playback receiver]', error);
    }
  };
  function publish(semantic = true) {
    holder.snapshot = freeze(clone(state));
    if (semantic) safe(onStateChange, holder.snapshot);
  }
  const valid = context => !disposed && context.id === operationId;
  function feedback(context, result) {
    if (valid(context))
      safe(onFeedback, freeze({ ...result, operationId: context.id }));
    return result;
  }
  function emit(instance, type, completed = false) {
    // The previous instance remains eligible for its final handoff event even
    // when a newer target owns the selection operation.
    if (!instance || !instance.played || instance.released) return;
    const position = completed
      ? instance.durationSeconds
      : instance.handle.position();
    let delivering = true;
    const event = freeze({
      type,
      operationId: instance.operationId,
      instanceId: instance.id,
      track: clone(instance.track),
      source: clone(instance.source),
      position,
      durationSeconds: instance.durationSeconds,
      completed,
      recordOnce() {
        if (!delivering || instance.recorded || Math.floor(position) < 1)
          return false;
        instance.recorded = true;
        return true;
      },
    });
    safe(onPlaybackEvent, event);
    delivering = false;
  }
  function release(instance) {
    if (!instance || instance.released) return;
    instance.released = true;
    instance.handle.dispose();
  }
  function rows(limit) {
    const bounded = Math.max(
      0,
      Math.min(1000, Number.isFinite(limit) ? Math.floor(limit) : 0)
    );
    const result = nextList.map((trackId, nextIndex) => ({
      trackId,
      group: 'next',
      index: nextIndex,
    }));
    for (let i = index + 1; i < list.length && result.length < bounded; i++) {
      result.push({ trackId: list[i], group: 'main', index: i });
    }
    return result.slice(0, bounded);
  }
  async function advance(context, direction = 1, visited = new Set()) {
    if (!valid(context)) return outcome('superseded');
    let id;
    if (direction === 1 && nextList.length) id = nextList.shift();
    else {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= list.length) {
        if (current) current.handle.pause();
        state.playing = false;
        publish();
        return outcome('unavailable', 'queue-ended');
      }
      index = targetIndex;
      id = list[index];
    }
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
      state.currentTrackID = track.id;
      state.progress = position;
      state.sourceInfo = null;
      state.enabled = true;
      state.durationSeconds = Math.floor((track.dt || 0) / 1000);
      state.currentTrackDuration = Math.max(
        0,
        state.durationSeconds - (state.durationSeconds > 1 ? 1 : 0)
      );
      publish();
      const resource = await resources.resolve(track);
      if (!valid(context)) return outcome('superseded');
      if (!resource) {
        feedback(context, outcome('unavailable', 'no-source'));
        // Finite traversal also prevents an unavailable repeated ID looping.
        const candidate = rows(1)[0];
        if (
          direction < 0
            ? index > 0
            : candidate && !visited.has(candidate.trackId)
        ) {
          await advance(context, direction, visited);
        }
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
          emit(instance, 'played');
        } else if (type === 'pause') {
          state.playing = false;
          publish();
        } else if (type === 'end') {
          state.playing = false;
          emit(instance, 'ended', true);
          publish();
          void advance(context);
        } else {
          void handleError(context, instance, value);
        }
      };
      preparation = new AbortController();
      preparations.add(preparation);
      prepared = await audio.prepare(resource, {
        signal: preparation.signal,
        volume: state.volume,
        autoplay: false,
        position,
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
        id: ++instanceId,
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
      publish();
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
      if (error.code === 3 || error.code === 4) {
        const reason = error.code === 4 ? 'unsupported-format' : 'audio-decode';
        if (error.code === 4) feedback(context, outcome('unavailable', reason));
        await advance(context, direction, visited);
        return valid(context)
          ? outcome('unavailable', reason)
          : outcome('superseded');
      }
      return feedback(context, outcome('failed', error));
    }
  }
  async function handleError(context, instance, error) {
    if (!valid(context) || current !== instance) return;
    const code = error && error.code;
    if (code === 3 || code === 4) {
      if (code === 4)
        feedback(context, outcome('unavailable', 'unsupported-format'));
      return advance(context);
    }
    return select(context, instance.track.id, {
      position: instance.handle.position(),
      prefetch: false,
    });
  }
  function runSelection(work) {
    operationId++;
    preparations.forEach(controller => controller.abort());
    preparations.clear();
    const context = {
      id: operationId,
      isCurrent: () => valid(context),
      installQueue(ids, source = {}, startTrackId) {
        if (!valid(context)) return;
        list = Array.from(ids);
        nextList = [];
        index =
          startTrackId == null ? 0 : Math.max(0, list.indexOf(startTrackId));
        state.playlistSource = clone(source);
        state.isPersonalFM = false;
        publish();
      },
      select: (id, options) => select(context, id, options),
    };
    if (disposed) return Promise.resolve(outcome('superseded'));
    return Promise.resolve()
      .then(() => (valid(context) ? work(context) : outcome('superseded')))
      .catch(error =>
        valid(context)
          ? feedback(context, outcome('failed', error))
          : outcome('superseded')
      );
  }
  const timer = schedule(() => {
    if (!current || disposed || current.operationId !== operationId) return;
    state.progress = current.handle.position();
    publish(false);
    safe(onProgress, state.progress);
  }, 1000);
  const playback = {
    get state() {
      return holder.snapshot;
    },
    playTracks(ids, { source = {}, startTrackId } = {}) {
      const copy = Array.from(ids);
      const sourceCopy = clone(source);
      return runSelection(context => {
        context.installQueue(copy, sourceCopy, startTrackId);
        return list.length
          ? context.select(list[index])
          : feedback(context, outcome('unavailable', 'empty-queue'));
      });
    },
    playQueuedTrack(id, { group = 'main', index: selectedIndex } = {}) {
      return runSelection(context => {
        if (group === 'next') {
          const position =
            selectedIndex == null ? nextList.indexOf(id) : selectedIndex;
          if (position < 0 || nextList[position] !== id)
            return outcome('unavailable', 'missing-track');
          nextList.splice(position, 1);
        } else {
          const position =
            selectedIndex == null ? list.indexOf(id) : selectedIndex;
          if (position < 0 || list[position] !== id)
            return outcome('unavailable', 'missing-track');
          index = position;
        }
        publish();
        return context.select(id);
      });
    },
    next() {
      if (!nextList.length && index + 1 >= list.length) {
        playback.pause();
        return Promise.resolve(outcome('unavailable', 'queue-ended'));
      }
      return runSelection(context => advance(context));
    },
    previous() {
      if (index <= 0) {
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
      safe(onProgress, state.progress);
    },
    position() {
      return current ? current.handle.position() : 0;
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      state.volume = Math.max(0, Math.min(1, value));
      if (current) current.handle.setVolume(state.volume);
      publish();
    },
    toggleMute() {
      if (state.volume) {
        volumeBeforeMuted = state.volume;
        playback.setVolume(0);
      } else playback.setVolume(volumeBeforeMuted || 1);
    },
    upcoming(limit = 100) {
      return freeze(clone(rows(limit)));
    },
    applyOutputDevice() {
      return current ? current.handle.applyOutputDevice() : Promise.resolve();
    },
    archive() {
      return clone({
        _progress: state.progress,
        _enabled: state.enabled,
        _repeatMode: state.repeatMode,
        _shuffle: state.shuffle,
        _reversed: state.reversed,
        _volume: state.volume,
        _volumeBeforeMuted: volumeBeforeMuted,
        _list: list,
        _current: index,
        _shuffledList: [],
        _shuffledCurrent: 0,
        _playlistSource: state.playlistSource,
        _currentTrack: state.currentTrack,
        _playNextList: nextList,
        _isPersonalFM: state.isPersonalFM,
        _personalFMTrack: state.personalFMTrack,
        _personalFMNextTrack: state.personalFMNextTrack,
      });
    },
    restore(archive, position = 0) {
      const saved = clone(archive);
      return runSelection(context => {
        context.installQueue(saved._list || [], saved._playlistSource, null);
        index = saved._current || 0;
        nextList = saved._playNextList || [];
        state.volume = saved._volume == null ? 1 : saved._volume;
        volumeBeforeMuted = saved._volumeBeforeMuted || 1;
        publish();
        return saved._enabled && saved._currentTrack?.id
          ? context.select(saved._currentTrack.id, {
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
