export function initializePlayerStorage(storage) {
  if (storage.getItem('appVersion') === '"0.2.5"') {
    storage.setItem('player', '{}');
  }
}

// The allowlist is also the legacy archive migration boundary.
const archiveFields = [
  '_enabled',
  '_repeatMode',
  '_shuffle',
  '_reversed',
  '_volume',
  '_volumeBeforeMuted',
  '_list',
  '_current',
  '_shuffledList',
  '_shuffledCurrent',
  '_playlistSource',
  '_currentTrack',
  '_playNextList',
  '_isPersonalFM',
  '_personalFMTrack',
  '_personalFMNextTrack',
];
function project(archive) {
  const result = {};
  archiveFields.forEach(key => {
    if (archive[key] !== undefined) result[key] = archive[key];
  });
  return result;
}
export function createPlayerStorage(storage) {
  const archive = project(JSON.parse(storage.getItem('player')) || {});
  const position = Number(storage.getItem('playerCurrentTrackTime')) || 0;
  let previous = JSON.stringify(archive);
  return {
    initial: { archive, position },
    save(value) {
      const serialized = JSON.stringify(project(value));
      if (serialized === previous) return;
      storage.setItem('player', serialized);
      previous = serialized;
    },
    saveProgress(value) {
      storage.setItem('playerCurrentTrackTime', value);
    },
  };
}
