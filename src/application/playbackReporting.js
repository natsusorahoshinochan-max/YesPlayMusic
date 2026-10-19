// Claims belong to the synchronous delivery of an effective Playback event.
// Requests run independently of the next selection and share the instance claim.
export function createPlaybackReporting({
  neteaseScrobble,
  lastfmScrobble,
  lastfmNowPlaying,
  getLastfmAuthorization,
  now = Date.now,
  onError = error =>
    console.debug('[playback reporting] request failed', error),
}) {
  const submit = (request, params, authorization, requireResponse = false) => {
    try {
      Promise.resolve(request(params, authorization))
        .then(response => {
          if (requireResponse && response == null)
            throw new Error('Missing NetEase playback report response');
        })
        .catch(onError);
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
      const authorization = getLastfmAuthorization();
      if (authorization.key !== undefined)
        submit(lastfmNowPlaying, params(), authorization);
      return;
    }
    if (event.type !== 'before-replace' && event.type !== 'ended') return;
    const time = Math.floor(event.completed ? durationSeconds : event.position);
    if (time < 1 || !event.recordOnce()) return;
    submit(
      neteaseScrobble,
      { id: track.id, sourceid: event.source.id, time },
      undefined,
      true
    );
    const authorization = getLastfmAuthorization();
    if (
      authorization.key !== undefined &&
      (time >= durationSeconds / 2 || time >= 240)
    ) {
      submit(
        lastfmScrobble,
        {
          ...params(),
          timestamp: Math.floor(now() / 1000) - time,
        },
        authorization
      );
    }
  };
}
