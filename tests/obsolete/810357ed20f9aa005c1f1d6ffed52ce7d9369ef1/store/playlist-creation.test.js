/* eslint-env jest */
import { createStore } from '@/store';

function setup(mode = 'account') {
  const values = {
    data: JSON.stringify({
      loginMode: mode,
      user: { userId: 3 },
      likedSongPlaylistID: 99,
    }),
  };
  const storage = {
    getItem: key => values[key] || null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
  const api = {
    createPlaylist: jest.fn().mockResolvedValue({ code: 200, id: 20 }),
    addOrRemoveTrackFromPlaylist: jest
      .fn()
      .mockResolvedValue({ body: { code: 200 } }),
    userPlaylist: jest
      .fn()
      .mockResolvedValue({ playlist: [{ id: 99 }, { id: 20 }] }),
  };
  const store = createStore({
    storage,
    credentials: { get: () => 'credential', remove() {} },
    library: { api },
  });
  return { store, api, storage };
}

test.each([undefined, []])(
  'creating without tracks returns the confirmed playlist ID and no addition',
  async trackIds => {
    const { store, api } = setup();
    await expect(
      store.dispatch('library/createPlaylist', {
        name: 'Private',
        private: true,
        trackIds,
      })
    ).resolves.toEqual({
      creation: { status: 'succeeded', playlistId: 20 },
      addition: { status: 'not-requested' },
      synchronization: 'completed',
    });
    expect(api.createPlaylist).toHaveBeenCalledWith({
      name: 'Private',
      privacy: 10,
    });
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
    expect(
      store.getters['library/collections'].playlists.map(p => p.id)
    ).toEqual([99, 20]);
  }
);

test('adding tracks restores the loaded range in remote order and continues paging', async () => {
  const { store, api } = setup();
  const ids = Array.from({ length: 750 }, (_, i) => i + 1);
  let order = ids;
  api.getPlaylistDetail = jest.fn(id =>
    Promise.resolve({
      playlist: {
        id,
        trackCount: order.length,
        trackIds: order.map(id => ({ id })),
        tracks: [{ id: order[0] }],
      },
    })
  );
  api.getTrackDetail = jest.fn(batch =>
    Promise.resolve({
      songs: batch
        .split(',')
        .map(Number)
        .filter(id => id !== 102)
        .map(id => ({ id })),
    })
  );
  await store.dispatch('playlistDetail/open', 20);
  await store.dispatch('playlistDetail/loadMore', { count: 500 });
  order = [900, ...ids.slice().reverse()];
  await expect(
    store.dispatch('library/addPlaylistTracks', {
      playlistId: 20,
      trackIds: [900, 901],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'completed',
  });
  expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
    op: 'add',
    pid: 20,
    tracks: '900,901',
  });
  const current = store.getters['playlistDetail/current'];
  expect(current.playlist.trackIds.slice(0, 3)).toEqual([
    { id: 900 },
    { id: 750 },
    { id: 749 },
  ]);
  expect(current.tracks).toHaveLength(601);
  expect(current.tracks.slice(0, 3).map(t => t.id)).toEqual([900, 750, 749]);
  await store.dispatch('playlistDetail/loadMore', { count: 100 });
  expect(api.getTrackDetail.mock.calls.at(-1)[0].split(',')[0]).toBe('150');
  const opened = store.getters['playlistDetail/current'];
  await store.dispatch('library/addPlaylistTracks', {
    playlistId: 30,
    trackIds: [900],
  });
  expect(store.getters['playlistDetail/current']).toBe(opened);
});

test.each([null, 'username'])(
  'creation and addition deny %p identity without remote writes',
  async mode => {
    const { store, api } = setup(mode);
    await expect(
      store.dispatch('library/createPlaylist', { name: 'List', trackIds: [7] })
    ).resolves.toEqual({
      creation: { status: 'denied', reason: 'account-required' },
      addition: { status: 'not-attempted' },
      synchronization: 'not-required',
    });
    await expect(
      store.dispatch('library/addPlaylistTracks', {
        playlistId: 20,
        trackIds: [7],
      })
    ).resolves.toEqual({
      outcome: { status: 'denied', reason: 'account-required' },
      synchronization: 'not-required',
    });
    expect(api.createPlaylist).not.toHaveBeenCalled();
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
  }
);

test.each([
  [
    { code: 502, message: 'name rejected' },
    { status: 'rejected', message: 'name rejected' },
  ],
  [undefined, { status: 'unconfirmed' }],
  [{ code: 200 }, { status: 'unconfirmed' }],
])(
  'unconfirmed or rejected creation prevents addition: %p',
  async (response, creation) => {
    const { store, api } = setup();
    api.createPlaylist.mockResolvedValue(response);
    await expect(
      store.dispatch('library/createPlaylist', { name: 'List', trackIds: [7] })
    ).resolves.toEqual({
      creation,
      addition: { status: 'not-attempted' },
      synchronization: 'not-required',
    });
    expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
    expect(api.userPlaylist).not.toHaveBeenCalled();
  }
);

test.each([
  [
    { body: { code: 502, message: 'cannot add' } },
    { status: 'rejected', message: 'cannot add' },
  ],
  [undefined, { status: 'unconfirmed' }],
  [{ code: 200 }, { status: 'succeeded' }],
])(
  'creation retains its ID when addition resolves %p and collection refresh fails',
  async (response, addition) => {
    const { store, api } = setup();
    api.createPlaylist.mockResolvedValue({
      body: { code: 200, playlist: { id: 20 } },
    });
    api.addOrRemoveTrackFromPlaylist.mockResolvedValue(response);
    api.userPlaylist.mockRejectedValue(new Error('read failed'));
    await expect(
      store.dispatch('library/createPlaylist', {
        name: 'List',
        trackIds: [7, 8],
      })
    ).resolves.toEqual({
      creation: { status: 'succeeded', playlistId: 20 },
      addition,
      synchronization: 'incomplete',
    });
    expect(api.addOrRemoveTrackFromPlaylist).toHaveBeenCalledWith({
      op: 'add',
      pid: 20,
      tracks: '7,8',
    });
    expect(api.userPlaylist).toHaveBeenCalledTimes(1);
  }
);

test('transport failure is unconfirmed independently for creation and addition; programming errors propagate', async () => {
  const { store, api } = setup();
  const transport = Object.assign(new Error('timeout'), { isAxiosError: true });
  api.createPlaylist.mockRejectedValueOnce(transport);
  await expect(
    store.dispatch('library/createPlaylist', { name: 'List', trackIds: [7] })
  ).resolves.toMatchObject({
    creation: { status: 'unconfirmed' },
    addition: { status: 'not-attempted' },
  });
  api.addOrRemoveTrackFromPlaylist.mockRejectedValueOnce(transport);
  await expect(
    store.dispatch('library/createPlaylist', { name: 'List', trackIds: [7] })
  ).resolves.toMatchObject({
    creation: { status: 'succeeded', playlistId: 20 },
    addition: { status: 'unconfirmed' },
    synchronization: 'completed',
  });
  api.createPlaylist.mockRejectedValueOnce(new TypeError('bad adapter'));
  await expect(
    store.dispatch('library/createPlaylist', { name: 'List' })
  ).rejects.toThrow('bad adapter');
});

test('adding to liked music attempts collection, IDs, preview and current detail despite read failures', async () => {
  const { store, api } = setup();
  api.getPlaylistDetail = jest.fn(id =>
    Promise.resolve({
      playlist: { id, trackIds: [], tracks: [], trackCount: 0 },
    })
  );
  await store.dispatch('playlistDetail/open', 99);
  api.getPlaylistDetail.mockResolvedValue({
    playlist: {
      id: 99,
      trackIds: [{ id: 7 }],
      tracks: [{ id: 7 }],
      trackCount: 1,
    },
  });
  api.getTrackDetail = jest.fn().mockResolvedValue({ songs: [{ id: 7 }] });
  api.userPlaylist.mockRejectedValue(new Error('collection failed'));
  api.userLikedSongsIDs = jest.fn().mockRejectedValue(new Error('IDs failed'));
  await expect(
    store.dispatch('library/addPlaylistTracks', {
      playlistId: 99,
      trackIds: [7],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(api.userLikedSongsIDs).toHaveBeenCalled();
  expect(store.getters['library/collections'].songsWithDetails).toEqual([
    { id: 7 },
  ]);
  expect(store.getters['playlistDetail/current'].tracks).toEqual([{ id: 7 }]);
});

test('confirmed addition to liked music retains known added IDs when refreshes fail', async () => {
  const { store, api } = setup();
  api.userPlaylist.mockRejectedValue(new Error('collection failed'));
  api.userLikedSongsIDs = jest.fn().mockRejectedValue(new Error('IDs failed'));
  api.getPlaylistDetail = jest
    .fn()
    .mockRejectedValue(new Error('preview failed'));
  await expect(
    store.dispatch('library/addPlaylistTracks', {
      playlistId: 99,
      trackIds: [7, 8, 7],
    })
  ).resolves.toEqual({
    outcome: { status: 'succeeded' },
    synchronization: 'incomplete',
  });
  expect(store.getters['library/collections'].songs).toEqual([7, 8]);
});

test('losing account permission during creation preserves its ID but denies the optional write', async () => {
  const { store, api } = setup();
  let finishCreation;
  api.createPlaylist.mockReturnValue(
    new Promise(resolve => {
      finishCreation = resolve;
    })
  );
  const creating = store.dispatch('library/createPlaylist', {
    name: 'List',
    trackIds: [7],
  });
  await store.dispatch('session/logout');
  finishCreation({ code: 200, id: 20 });
  await expect(creating).resolves.toEqual({
    creation: { status: 'succeeded', playlistId: 20 },
    addition: { status: 'denied', reason: 'account-required' },
    synchronization: 'completed',
  });
  expect(api.addOrRemoveTrackFromPlaylist).not.toHaveBeenCalled();
});
