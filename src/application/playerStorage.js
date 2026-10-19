export function initializePlayerStorage(storage) {
  if (storage.getItem('appVersion') === '"0.2.5"') {
    storage.setItem('player', '{}');
  }
}
