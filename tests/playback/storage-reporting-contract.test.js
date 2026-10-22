import { createPlayback } from '@/playback';
import {
  createPlayerStorage,
  initializePlayerStorage,
} from '@/application/playerStorage';
import { createPlaybackReporting } from '@/application/playbackReporting';

function player(onPlaybackEvent) {
  const handles = [];
  const playback = createPlayback({
    getTrack: async id => ({
      id,
      name: `Track ${id}`,
      dt: 100000,
      ar: [{ name: 'Artist' }],
      al: { name: 'Album' },
      no: 2,
    }),
    resources: { resolve: async () => ({ kind: 'url', url: '/audio' }) },
    audio: {
      prepare: async (resource, callbacks) => {
        let position = 0;
        const handle = {
          play: () => callbacks.onPlay(),
          pause: () => callbacks.onPause(),
          seek: value => {
            position = value;
          },
          position: () => position,
          setVolume: () => {},
          applyOutputDevice: async () => {},
          dispose: () => {},
          end: callbacks.onEnd,
        };
        handles.push(handle);
        return handle;
      },
    },
    onPlaybackEvent,
    setInterval: () => 0,
    clearInterval: () => {},
  });
  return { playback, handles };
}

beforeEach(() => localStorage.clear());

test('Playback restores its queue, modes and independent progress without sharing archive references', async () => {
  const { playback } = player();
  await playback.playTracks([1, 2], { source: { type: 'playlist', id: 9 } });
  playback.enqueueNext(3);
  playback.setRepeatMode('on');
  playback.setVolume(0.4);
  playback.toggleMute();
  playback.seek(23);
  const storage = createPlayerStorage(localStorage);
  const archive = playback.archive();
  storage.save(archive);
  storage.saveProgress(playback.position());
  archive._list.push(99);
  expect(playback.upcoming(2).map(row => row.trackId)).toEqual([3, 2]);
  const restored = player().playback;
  const initial = createPlayerStorage(localStorage).initial;
  await restored.restore(initial.archive, initial.position);
  initial.archive._list.push(98);
  expect(restored.state).toMatchObject({
    currentTrack: { id: 1 },
    playing: false,
    repeatMode: 'on',
    volume: 0,
    playlistSource: { type: 'playlist', id: 9 },
  });
  expect(restored.position()).toBe(23);
  expect(restored.upcoming(2).map(row => row.trackId)).toEqual([3, 2]);
  restored.toggleMute();
  expect(restored.state.volume).toBe(0.4);
  playback.dispose();
  restored.dispose();
});

test('progress does not rewrite the queue archive, and a failed save can retry the same value', async () => {
  const { playback } = player();
  await playback.playTracks([1]);
  const storage = createPlayerStorage(localStorage);
  storage.save(playback.archive());
  const write = jest.spyOn(Storage.prototype, 'setItem');
  playback.seek(12);
  storage.saveProgress(playback.position());
  storage.save(playback.archive());
  expect(write.mock.calls).toEqual([['playerCurrentTrackTime', 12]]);
  playback.setRepeatMode('one');
  write.mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  expect(() => storage.save(playback.archive())).toThrow('disk full');
  storage.save(playback.archive());
  const restored = player().playback;
  const initial = createPlayerStorage(localStorage).initial;
  await restored.restore(initial.archive, initial.position);
  expect(restored.state.repeatMode).toBe('one');
  expect(restored.position()).toBe(12);
  playback.dispose();
  restored.dispose();
});

test('the 0.2.5 migration resets the incompatible player archive', async () => {
  localStorage.setItem('appVersion', '"0.2.5"');
  localStorage.setItem('player', '{"_enabled":true,"_currentTrack":{"id":1}}');
  initializePlayerStorage(localStorage);
  const { playback } = player();
  const { archive, position } = createPlayerStorage(localStorage).initial;
  await playback.restore(archive, position);
  expect(playback.state.enabled).toBe(false);
  expect(playback.state.currentTrack.id).toBe(0);
  playback.dispose();
});

test('reporting uses effective playback time and records a naturally ended instance once', async () => {
  const neteaseScrobble = jest.fn();
  const lastfmScrobble = jest.fn();
  const lastfmNowPlaying = jest.fn();
  const authorization = { key: 'lastfm-session' };
  const { playback, handles } = player(
    createPlaybackReporting({
      neteaseScrobble,
      lastfmScrobble,
      lastfmNowPlaying,
      getLastfmAuthorization: () => authorization,
      now: () => 200000,
    })
  );
  const play = id =>
    playback.playTracks([id], { source: { type: 'playlist', id: 9 } });
  await play(1);
  playback.seek(0.9);
  await play(2);
  expect(neteaseScrobble).not.toHaveBeenCalled();
  playback.seek(49.9);
  await play(3);
  expect(neteaseScrobble).toHaveBeenLastCalledWith(
    { id: 2, sourceid: 9, time: 49 },
    undefined
  );
  expect(lastfmScrobble).not.toHaveBeenCalled();
  playback.seek(50.8);
  await play(4);
  expect(lastfmScrobble).toHaveBeenLastCalledWith(
    {
      artist: 'Artist',
      track: 'Track 3',
      album: 'Album',
      trackNumber: 2,
      duration: 100,
      timestamp: 150,
    },
    authorization
  );
  playback.seek(1);
  const ending = handles[3];
  ending.end();
  expect(neteaseScrobble).toHaveBeenLastCalledWith(
    { id: 4, sourceid: 9, time: 100 },
    undefined
  );
  await play(5);
  ending.end();
  expect(neteaseScrobble).toHaveBeenCalledTimes(3);
  expect(lastfmScrobble).toHaveBeenCalledTimes(2);
  expect(lastfmNowPlaying).toHaveBeenCalledTimes(5);
  playback.dispose();
});
