export function initializePlayerStorage(storage) {
  if (storage.getItem('appVersion') === '"0.2.5"') {
    storage.setItem('player', '{}');
  }
}

export function createPlayerStorage(storage) {
  const archive = JSON.parse(storage.getItem('player')) || {};
  const position = Number(storage.getItem('playerCurrentTrackTime')) || 0;
  let previous = JSON.stringify(archive);
  return {
    initial: { archive, position },
    save(value) {
      const serialized = JSON.stringify(value);
      if (serialized === previous) return;
      storage.setItem('player', serialized);
      previous = serialized;
    },
    saveProgress(value) {
      storage.setItem('playerCurrentTrackTime', value);
    },
  };
}
