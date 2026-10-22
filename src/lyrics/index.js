import Vue from 'vue';
import { lyricParser } from '@/utils/lyrics';

// One renderer owns content and line position; consumers only request a clock.
export function createLyrics({
  playback,
  getIdentity,
  getLyric,
  getCloudLyric,
  onContent = () => {},
  onLine = () => {},
  setInterval: schedule = setInterval,
  clearInterval: cancel = clearInterval,
}) {
  const state = Vue.observable({
    trackId: null,
    generation: 0,
    status: 'idle',
    raw: '',
    lyric: [],
    tlyric: [],
    romalyric: [],
    translation: [],
    romanization: [],
    currentIndex: -1,
    currentLine: '',
  });
  let track;
  let disposed = false;
  let clock;
  let demand = 0;
  let request;
  let identityPending = false;
  function position() {
    if (disposed) return;
    const seconds = playback.position();
    let index = -1;
    state.lyric.forEach((line, i) => {
      if (seconds >= line.time) index = i;
    });
    if (index === state.currentIndex) return;
    state.currentIndex = index;
    state.currentLine = state.lyric[index]?.content || '';
    onLine(state.currentLine);
  }
  function updateClock() {
    const needed =
      demand > 0 && playback.state.playing && state.lyric.length > 0;
    if (needed && clock === undefined) clock = schedule(position, 50);
    if (!needed && clock !== undefined) {
      cancel(clock);
      clock = undefined;
    }
  }
  function clear(status) {
    Object.assign(state, {
      status,
      raw: '',
      lyric: [],
      tlyric: [],
      romalyric: [],
      translation: [],
      romanization: [],
      currentIndex: -1,
      currentLine: '',
    });
    updateClock();
    onLine('');
    onContent(state);
  }
  const align = (lines, secondary) =>
    lines.map(line => ({
      ...line,
      contents: [
        line.content,
        secondary.find(other => other.time === line.time)?.content,
      ].filter(Boolean),
    }));
  function load() {
    if (disposed || !track) return Promise.resolve();
    const generation = state.generation;
    const selectedTrack = track;
    const selectedIdentity = getIdentity();
    const isCurrent = () => !disposed && generation === state.generation;
    clear('loading');
    request = Promise.resolve()
      .then(() => {
        if (disposed || generation !== state.generation) return;
        return selectedTrack.pc != null &&
          selectedTrack.cd == null &&
          selectedIdentity.hasAccount &&
          selectedIdentity.userId
          ? getCloudLyric(selectedTrack.id, selectedIdentity.userId, {
              isCurrent,
            }).then(data => {
              if (!data || typeof data !== 'object')
                throw new Error('Lyrics response unavailable');
              return { lrc: { lyric: data.lrc || '' } };
            })
          : getLyric(selectedTrack.id, { isCurrent });
      })
      .then(data => {
        if (disposed || generation !== state.generation) return;
        const parsed = lyricParser(data);
        let lyric = parsed.lyric.filter(
          line =>
            line.content && !/^作(词|曲)\s*(:|：)\s*无$/.test(line.content)
        );
        if (
          lyric.length <= 10 &&
          lyric.some(line => line.content === '纯音乐，请欣赏')
        ) {
          const author = selectedTrack.ar?.[0]?.name;
          lyric = lyric.filter(
            line =>
              !/^作(词|曲)\s*(:|：)\s*/.test(line.content) ||
              line.content.replace(/^作(词|曲)\s*(:|：)\s*/, '') !== author
          );
          if (lyric.length === 1) lyric = [];
        }
        Object.assign(state, parsed, {
          lyric,
          raw: data?.lrc?.lyric || '',
          status: lyric.length ? 'ready' : 'empty',
          translation: align(lyric, parsed.tlyric),
          romanization: align(lyric, parsed.romalyric),
        });
        position();
        updateClock();
        onContent(state);
      })
      .catch(() => {
        if (disposed || generation !== state.generation) return;
        clear('failed');
      });
    return request;
  }
  function setTrack(next) {
    if (disposed) return;
    track = next;
    state.generation++;
    state.trackId = identityPending ? null : track?.id ?? null;
    if (track && !identityPending) load();
    else clear('idle');
  }
  return Object.freeze({
    state,
    identityChanged() {
      if (disposed) return;
      identityPending = true;
      state.trackId = null;
      state.generation++;
      clear('idle');
    },
    identityReady() {
      if (!identityPending) return;
      identityPending = false;
      setTrack(track);
    },
    setTrack,
    playbackChanged() {
      position();
      updateClock();
    },
    position,
    retry() {
      if (state.status === 'loading') return request;
      state.generation++;
      return load();
    },
    consume() {
      if (disposed) return () => {};
      demand++;
      position();
      updateClock();
      let released = false;
      return () => {
        if (!released) {
          released = true;
          demand--;
          updateClock();
        }
      };
    },
    dispose() {
      disposed = true;
      state.generation++;
      if (clock !== undefined) cancel(clock);
      clock = undefined;
    },
  });
}
