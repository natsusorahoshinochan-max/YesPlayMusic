// Source requests stay inside one selection operation, including intelligence's
// seed-list request and the recommendation request that follows it.
export function createSourceOperations({
  runSelection,
  sourceLists,
  feedback,
}) {
  function playSource(
    type,
    id,
    { startTrackId, fresh = false } = {},
    intelligence = false
  ) {
    return runSelection(async context => {
      let ids = await sourceLists[type](id, { fresh });
      if (!context.isCurrent()) return { status: 'superseded' };
      if (intelligence && ids.length) {
        const seed = ids[Math.floor(Math.random() * ids.length)];
        ids = await sourceLists.intelligence(id, seed);
      }
      if (!context.isCurrent()) return { status: 'superseded' };
      const first = context.installQueue(ids, { type, id }, startTrackId);
      return ids.length
        ? context.select(first)
        : feedback(context, { status: 'unavailable', reason: 'empty-queue' });
    });
  }
  return {
    playPlaylist: (id, options) => playSource('playlist', id, options),
    playAlbum: (id, options) => playSource('album', id, options),
    playArtist: (id, options) => playSource('artist', id, options),
    playIntelligencePlaylist: (id, options) =>
      playSource('playlist', id, options, true),
  };
}
