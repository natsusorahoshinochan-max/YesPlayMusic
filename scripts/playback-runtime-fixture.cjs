/* Browser-compatible fixture I/O. Run on a fresh, initialized app origin. */
async function seedPlaybackRuntimeFixture() {
  const ids = [900000001, 900000002];
  const tracks = ids.map((id, index) => ({
    id,
    name: `Runtime tone ${index + 1}`,
    ar: [{ id: 900000010, name: 'Runtime fixture' }],
    al: { id: 900000020, name: 'Local WAV', picUrl: '' },
    no: index + 1,
    dt: 12000,
    fee: 0,
    st: 0,
  }));
  const bytes = new ArrayBuffer(44 + 44100 * 12 * 2);
  const view = new DataView(bytes);
  const ascii = (offset, value) =>
    [...value].forEach((char, i) =>
      view.setUint8(offset + i, char.charCodeAt(0))
    );
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, bytes.byteLength - 44, true);
  for (let i = 0; i < 44100 * 12; i++)
    view.setInt16(
      44 + i * 2,
      Math.sin((i * Math.PI * 880) / 44100) * 2500,
      true
    );
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('yesplaymusic');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['trackDetail', 'trackSources'], 'readwrite');
      tracks.forEach(track => {
        tx.objectStore('trackDetail').put({
          id: track.id,
          detail: track,
          privileges: { id: track.id, st: 0, fee: 0, pl: 128000 },
          updateTime: Date.now(),
        });
        tx.objectStore('trackSources').put({
          id: track.id,
          source: bytes,
          bitRate: 128000,
          from: 'netease',
          name: track.name,
          artist: track.ar[0].name,
          createTime: Date.now(),
        });
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  localStorage.setItem(
    'player',
    JSON.stringify({
      _enabled: true,
      _repeatMode: 'off',
      _shuffle: false,
      _reversed: false,
      _volume: 0.3,
      _volumeBeforeMuted: 0.3,
      _list: ids,
      _current: 0,
      _shuffledList: ids,
      _shuffledCurrent: 0,
      _playlistSource: { type: 'url', id: '/runtime-fixture' },
      _currentTrack: tracks[0],
      _playNextList: [],
      _isPersonalFM: false,
      _personalFMTrack: tracks[0],
      _personalFMNextTrack: tracks[1],
    })
  );
  localStorage.setItem('playerCurrentTrackTime', '0.5');
  return { ids, tracks, bytes: bytes.byteLength };
}
module.exports = { seedPlaybackRuntimeFixture };
