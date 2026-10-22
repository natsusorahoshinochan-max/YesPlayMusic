import {
  accountRequired,
  changeResult,
  performLibraryWrite,
  synchronize,
} from '../libraryChange';

export default function createLibrary(snapshot, { api }) {
  function setCollection({ commit }, name, data) {
    commit('setCollection', { name, data });
  }

  async function loadPlaylists(context) {
    const result = await api.userPlaylist({
      uid: context.state.user.userId,
      limit: 2000,
      timestamp: Date.now(),
    });
    setCollection(context, 'playlists', result.playlist);
    context.commit('setLikedSongPlaylistID', result.playlist[0]?.id || 0);
  }

  async function loadPreview(context) {
    const id = context.state.likedSongPlaylistID;
    const result = id ? await api.getPlaylistDetail(id, true) : null;
    const ids = id ? result.playlist.trackIds.map(track => track.id) : [];
    if (!context.rootGetters['session/hasAccount']) {
      setCollection(context, 'songs', ids);
    }
    const tracks = ids.length
      ? (await api.getTrackDetail(ids.slice(0, 12))).songs
      : [];
    setCollection(context, 'songsWithDetails', tracks);
    context.commit('setPreviewReady');
  }

  async function loadSongs(context) {
    const result = await api.userLikedSongsIDs(context.state.user.userId);
    setCollection(context, 'songs', result.ids);
  }

  async function loadCollection(context, name, endpoint, limit) {
    const result = await api[endpoint]({ limit });
    setCollection(context, name, result.data);
  }

  async function loadHistory(context) {
    const [allData, weekData] = await Promise.all(
      [0, 1].map(type =>
        api.userPlayHistory({ uid: context.state.user.userId, type })
      )
    );
    setCollection(context, 'playHistory', { allData, weekData });
  }

  function reportBackground(context, work) {
    work.catch(() =>
      context.dispatch('showToast', '音乐库部分内容加载失败', { root: true })
    );
  }

  async function loadLibrary(context, includeHistory) {
    if (!context.rootGetters['session/hasLibraryIdentity']) return;
    if (context.rootGetters['session/hasAccount']) {
      const result = await api.userAccount();
      if (result.code === 200) context.commit('setUser', result.profile);
      reportBackground(context, loadSongs(context));
      reportBackground(
        context,
        loadCollection(context, 'albums', 'likedAlbums', 2000)
      );
      reportBackground(
        context,
        loadCollection(context, 'artists', 'likedArtists', 2000)
      );
      reportBackground(
        context,
        loadCollection(context, 'mvs', 'likedMVs', 1000)
      );
      reportBackground(
        context,
        loadCollection(context, 'cloudDisk', 'cloudDisk', 1000)
      );
      if (includeHistory) reportBackground(context, loadHistory(context));
    }
    await loadPlaylists(context);
    await loadPreview(context);
  }

  function trackAdditionUpdates(context, playlistId, trackIds) {
    const attempts = [
      () => loadPlaylists(context),
      () =>
        context.dispatch(
          'playlistDetail/applyLibraryChange',
          {
            type: 'tracks-added',
            playlistId,
          },
          { root: true }
        ),
    ];
    if (Number(playlistId) === Number(context.state.likedSongPlaylistID)) {
      setCollection(context, 'songs', [
        ...new Set([...context.state.collections.songs, ...trackIds]),
      ]);
      attempts.push(
        () => loadSongs(context),
        () => loadPreview(context)
      );
    }
    return attempts;
  }

  async function write(context, request, update) {
    if (!context.rootGetters['session/hasAccount'])
      return changeResult(accountRequired);
    let response;
    const outcome = await performLibraryWrite(async () => {
      response = await request();
      return response;
    });
    if (outcome.status !== 'succeeded') return changeResult(outcome);
    return changeResult(outcome, await synchronize(update(response)));
  }

  function detailChange(context, playlistId, type, extra = {}) {
    return context.dispatch(
      'playlistDetail/applyLibraryChange',
      { playlistId, type, ...extra },
      { root: true }
    );
  }

  function updateFavoriteCollection(context, name, id, favorite) {
    if (favorite) return;
    setCollection(
      context,
      name,
      context.state.collections[name].filter(
        item => Number(item.id || item.vid) !== Number(id)
      )
    );
  }

  return {
    namespaced: true,
    state: () => ({
      ...snapshot,
      previewReady: false,
      collections: {
        songs: [],
        songsWithDetails: [],
        playlists: [],
        albums: [],
        artists: [],
        mvs: [],
        cloudDisk: [],
        playHistory: { weekData: [], allData: [] },
      },
    }),
    getters: {
      user: state => state.user,
      likedSongPlaylistID: state => state.likedSongPlaylistID,
      collections: state => state.collections,
      previewReady: state => state.previewReady,
    },
    mutations: {
      setUser(state, user) {
        state.user = user;
      },
      setLikedSongPlaylistID(state, id) {
        state.likedSongPlaylistID = id;
      },
      setCollection(state, { name, data }) {
        state.collections[name] = data;
      },
      setPreviewReady(state) {
        state.previewReady = true;
      },
    },
    actions: {
      clearIdentity({ commit }) {
        commit('setUser', {});
        commit('setLikedSongPlaylistID', 0);
      },
      deletePlaylist(context, id) {
        return write(
          context,
          () => api.deletePlaylist(id),
          () => {
            updateFavoriteCollection(context, 'playlists', id, false);
            return [
              () => detailChange(context, id, 'deleted'),
              () => loadPlaylists(context),
            ];
          }
        );
      },
      uploadCloudTrack(context, file) {
        return write(
          context,
          () => api.uploadSong(file),
          ({ track }) => {
            if (track)
              setCollection(context, 'cloudDisk', [
                track,
                ...context.state.collections.cloudDisk.filter(
                  item => item.songId !== track.songId
                ),
              ]);
            return [
              () => loadCollection(context, 'cloudDisk', 'cloudDisk', 1000),
            ];
          }
        );
      },
      deleteCloudTrack(context, id) {
        return write(
          context,
          () => api.cloudDiskTrackDelete(id),
          () => {
            setCollection(
              context,
              'cloudDisk',
              context.state.collections.cloudDisk.filter(
                track => Number(track.songId) !== Number(id)
              )
            );
            return [
              () => loadCollection(context, 'cloudDisk', 'cloudDisk', 1000),
            ];
          }
        );
      },
      setPlaylistFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.subscribePlaylist({ id, t: favorite ? 1 : 2 }),
          () => {
            updateFavoriteCollection(context, 'playlists', id, favorite);
            return [
              () => detailChange(context, id, 'favorite', { favorite }),
              () => loadPlaylists(context),
            ];
          }
        );
      },
      removePlaylistTracks(context, { playlistId, trackIds }) {
        return write(
          context,
          () =>
            api.addOrRemoveTrackFromPlaylist({
              op: 'del',
              pid: playlistId,
              tracks: trackIds.join(','),
            }),
          () => {
            const attempts = [
              () =>
                context.dispatch(
                  'playlistDetail/applyLibraryChange',
                  { type: 'tracks-removed', playlistId, trackIds },
                  { root: true }
                ),
              () => loadPlaylists(context),
            ];
            if (
              Number(playlistId) === Number(context.state.likedSongPlaylistID)
            ) {
              const removed = new Set(trackIds);
              setCollection(
                context,
                'songs',
                context.state.collections.songs.filter(id => !removed.has(id))
              );
              setCollection(
                context,
                'songsWithDetails',
                context.state.collections.songsWithDetails.filter(
                  track => !removed.has(track.id)
                )
              );
              attempts.push(
                () => loadSongs(context),
                () => loadPreview(context)
              );
            }
            return attempts;
          }
        );
      },
      addPlaylistTracks(context, { playlistId, trackIds }) {
        return write(
          context,
          () =>
            api.addOrRemoveTrackFromPlaylist({
              op: 'add',
              pid: playlistId,
              tracks: trackIds.join(','),
            }),
          () => trackAdditionUpdates(context, playlistId, trackIds)
        );
      },
      async createPlaylist(
        context,
        { name, private: privatePlaylist = false, trackIds = [] }
      ) {
        const requested = trackIds.length > 0;
        let creation = accountRequired;
        let response;
        if (context.rootGetters['session/hasAccount']) {
          creation = await performLibraryWrite(async () => {
            response = await api.createPlaylist({
              name,
              privacy: privatePlaylist ? 10 : 0,
            });
            return response;
          });
        }
        let addition = {
          status: requested ? 'not-attempted' : 'not-requested',
        };
        if (creation.status !== 'succeeded') {
          return { creation, addition, synchronization: 'not-required' };
        }
        const body =
          response?.body?.code !== undefined ? response.body : response;
        const playlistId = body.id ?? body.playlist?.id;
        if (playlistId == null) {
          return {
            creation: { status: 'unconfirmed' },
            addition,
            synchronization: 'not-required',
          };
        }
        creation = { ...creation, playlistId };
        if (requested && !context.rootGetters['session/hasAccount']) {
          addition = accountRequired;
        } else if (requested) {
          addition = await performLibraryWrite(() =>
            api.addOrRemoveTrackFromPlaylist({
              op: 'add',
              pid: playlistId,
              tracks: trackIds.join(','),
            })
          );
        }
        const synchronization = await synchronize(
          addition.status === 'succeeded'
            ? trackAdditionUpdates(context, playlistId, trackIds)
            : [() => loadPlaylists(context)]
        );
        return { creation, addition, synchronization };
      },
      setAlbumFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.likeAAlbum({ id, t: favorite ? 1 : 0 }),
          () => {
            updateFavoriteCollection(context, 'albums', id, favorite);
            return [
              () => loadCollection(context, 'albums', 'likedAlbums', 2000),
            ];
          }
        );
      },
      setArtistFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.followAArtist({ id, t: favorite ? 1 : 0 }),
          () => {
            updateFavoriteCollection(context, 'artists', id, favorite);
            return [
              () => loadCollection(context, 'artists', 'likedArtists', 2000),
            ];
          }
        );
      },
      setMVFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.likeAMV({ mvid: id, t: favorite ? 1 : 0 }),
          () => {
            updateFavoriteCollection(context, 'mvs', id, favorite);
            return [() => loadCollection(context, 'mvs', 'likedMVs', 1000)];
          }
        );
      },
      toggleTrackFavorite(context, id) {
        const like = !context.state.collections.songs.includes(id);
        return write(
          context,
          () => api.likeATrack({ id, like }),
          () => {
            setCollection(
              context,
              'songs',
              like
                ? [...context.state.collections.songs, id]
                : context.state.collections.songs.filter(song => song !== id)
            );
            if (!like)
              setCollection(
                context,
                'songsWithDetails',
                context.state.collections.songsWithDetails.filter(
                  track => track.id !== id
                )
              );
            let playlistReady;
            const identifyPlaylist = () => {
              if (context.state.likedSongPlaylistID)
                return Promise.resolve(context.state.likedSongPlaylistID);
              if (!playlistReady)
                playlistReady = loadPlaylists(context).then(
                  () => context.state.likedSongPlaylistID
                );
              return playlistReady;
            };
            return [
              async () => {
                await identifyPlaylist();
                await loadPreview(context);
              },
              async () => {
                const playlistId = await identifyPlaylist();
                if (like) {
                  await detailChange(context, playlistId, 'reload');
                } else {
                  await detailChange(context, playlistId, 'tracks-removed', {
                    trackIds: [id],
                  });
                }
              },
            ];
          }
        );
      },
      loadApplication: context => loadLibrary(context, false),
      loadPage: context => loadLibrary(context, true),
    },
  };
}
