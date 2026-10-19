/* eslint-env jest */
test('favorite changes notify the live Player and Electron of current track membership', async () => {
  const environment = process.env;
  const requireDesktop = window.require;
  const send = jest.fn();
  try {
    process.env = { ...environment, IS_ELECTRON: true };
    window.require = () => ({ ipcRenderer: { send } });
    global.indexedDB = { deleteDatabase() {} };
    localStorage.clear();
    localStorage.setItem(
      'data',
      JSON.stringify({
        loginMode: 'account',
        user: { userId: 7 },
        likedSongPlaylistID: 20,
      })
    );
    const { createStore } = require('@/store');
    const Player = require('@/utils/Player').default;
    const api = {
      likeATrack: jest.fn().mockResolvedValue({ code: 200 }),
      getPlaylistDetail: jest
        .fn()
        .mockResolvedValue({ playlist: { trackIds: [] } }),
    };
    const store = createStore({
      credentials: { get: () => 'token' },
      library: {
        api,
        notifyLikedSongsChanged: () => store.state.player.sendSelfToIpcMain(),
      },
    });
    const player = Object.create(Player.prototype);
    player._currentTrack = { id: 50 };
    player._playing = true;
    store.state.player = player;
    send.mockClear();
    await store.dispatch('library/toggleTrackFavorite', 50);
    expect(send).toHaveBeenCalledWith('player', {
      playing: true,
      likedCurrentTrack: true,
    });
    await store.dispatch('library/toggleTrackFavorite', 50);
    expect(send).toHaveBeenLastCalledWith('player', {
      playing: true,
      likedCurrentTrack: false,
    });
  } finally {
    process.env = environment;
    window.require = requireDesktop;
  }
});
