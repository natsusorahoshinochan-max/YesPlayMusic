import { createPlayer } from '@/application/player';
import { startApplication } from '@/application/startup';
import { createAudioResources } from '@/playback/audioResources';
import { createPreferenceEffects } from '@/application/preferenceEffects';

// All application playback controls receive the same real Playback instance;
// only metadata, storage, audio hardware and startup platform work are replaced.
test('startup delivers one assembled Playback and feedback for a complete existing-track operation', async () => {
  const notify = jest.fn();
  const store = {
    state: { player: null },
    getters: { 'preferences/settings': {}, 'session/hasAccount': false },
    dispatch: jest.fn(async (type, message) => {
      if (type === 'showToast') notify(message);
      if (type === 'preferences/applyRestored')
        await preferenceEffects.applyOutputDevice();
    }),
  };
  const preferenceEffects = createPreferenceEffects({
    getLocale: () => ({}),
    getPlayer: () => store.state.player,
    ipcRenderer: null,
  });
  const audio = {
    prepare: jest.fn(async (resource, options) => ({
      play: () => options.onPlay(),
      pause: () => options.onPause(),
      position: () => 0,
      seek() {},
      setVolume() {},
      applyOutputDevice() {},
      dispose() {},
    })),
  };
  const getMP3 = jest.fn().mockResolvedValue({ data: [{ url: null }] });
  const resources = createAudioResources({
    cache: {
      getTrackSource: async () => null,
      cacheTrackSource: async () => {},
    },
    getMP3,
    hasAccount: () => true,
    isElectron: false,
    settings: () => ({}),
  });
  let instance;
  const result = await startApplication({
    createStore: () => store,
    initializeLocale: () => ({}),
    initializeAppearance() {},
    configureRequest() {},
    getCookie() {},
    createPlayer({ store: applicationStore }) {
      instance = createPlayer({
        store: applicationStore,
        resources,
        audio,
        getTrack: async id => ({ id, name: 'Song', dt: 2000, ar: [], al: {} }),
        setInterval: () => 1,
        clearInterval() {},
      });
      return instance;
    },
    mount: ({ store: mountedStore }) => mountedStore.state.player,
  });
  expect(result).toBe(instance);
  expect(store.state.player).toBe(instance);
  expect(
    await result.playTracks([1], { source: { id: 10, type: 'playlist' } })
  ).toEqual({ status: 'unavailable', reason: 'no-source' });
  expect(notify).toHaveBeenCalledTimes(1);
  getMP3.mockResolvedValue({
    data: [{ url: 'https://audio/one', br: 320000, freeTrialInfo: null }],
  });
  expect(
    await store.state.player.playTracks([1], {
      source: { id: 20, type: 'album' },
    })
  ).toEqual({ status: 'completed' });
  expect(store.state.player.state).toMatchObject({
    currentTrackID: 1,
    playing: true,
    playlistSource: { id: 20, type: 'album' },
    sourceInfo: { from: 'netease' },
  });
  expect(audio.prepare).toHaveBeenCalledTimes(1);
  result.dispose();
});
