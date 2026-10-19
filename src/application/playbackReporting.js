// Claims belong to the synchronous delivery of an effective Playback event.
// Requests run independently of the next selection and share the instance claim.
export function createPlaybackReporting({
  neteaseScrobble,
  lastfmScrobble,
  lastfmNowPlaying,
  getLastfmKey,
  now = Date.now,
  onError = error =>
    console.debug('[playback reporting] request failed', error),
}) {
  const submit = (request, params) => {
    try {
      Promise.resolve(request(params)).catch(onError);
    } catch (error) {
      onError(error);
    }
  };
  return event => {
    const { track, durationSeconds } = event;
    const params = () => ({
      artist: track.ar[0].name,
      track: track.name,
      album: track.al.name,
      trackNumber: track.no,
      duration: durationSeconds,
    });
    if (event.type === 'played') {
      if (getLastfmKey() !== undefined) submit(lastfmNowPlaying, params());
      return;
    }
    if (event.type !== 'before-replace' && event.type !== 'ended') return;
    const time = Math.floor(event.completed ? durationSeconds : event.position);
    if (time < 1 || !event.recordOnce()) return;
    submit(neteaseScrobble, { id: track.id, sourceid: event.source.id, time });
    if (
      getLastfmKey() !== undefined &&
      (time >= durationSeconds / 2 || time >= 240)
    ) {
      submit(lastfmScrobble, {
        ...params(),
        timestamp: Math.floor(now() / 1000) - time,
      });
    }
  };
}
