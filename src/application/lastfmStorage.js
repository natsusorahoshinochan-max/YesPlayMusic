export function createLastfmStorage(storage) {
  return {
    read: () => JSON.parse(storage.getItem('lastfm')) || {},
    save: authorization =>
      storage.setItem('lastfm', JSON.stringify(authorization)),
    remove: () => storage.removeItem('lastfm'),
  };
}
