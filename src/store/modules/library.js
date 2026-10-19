import {
  accountRequired,
  changeResult,
  performLibraryWrite,
  synchronize,
} from '../libraryChange';

export default function createLibrary(
  snapshot,
  { api = {}, notifyLikedSongsChanged = () => {} } = {}
) {
  function setCollection({ commit }, name, data) {
    commit('setCollection', { name, data });
    if (name === 'songs') notifyLikedSongsChanged();
  }

  async function loadPlaylists(context) {
    const result = await api.userPlaylist({
      uid: context.state.user.userId,
      limit: 2000,
      timestamp: Date.now(),
    });
    if (!Array.isArray(result?.playlist))
      throw new Error('Playlist collection unavailable');
    if (result.playlist) {
      setCollection(context, 'playlists', result.playlist);
      context.commit('setLikedSongPlaylistID', result.playlist[0]?.id || 0);
    }
  }

  async function loadPreview(context) {
    const id = context.state.likedSongPlaylistID;
    const result = id ? await api.getPlaylistDetail(id, true) : null;
    if (id && !Array.isArray(result?.playlist?.trackIds))
      throw new Error('Liked songs preview unavailable');
    const ids = result?.playlist?.trackIds?.map(track => track.id) || [];
    if (!context.rootGetters['session/hasAccount']) {
      setCollection(context, 'songs', ids);
    }
    const tracks = ids.length
      ? (await api.getTrackDetail(ids.slice(0, 12).join(','))).songs
      : [];
    if (!Array.isArray(tracks))
      throw new Error('Liked songs preview tracks unavailable');
    setCollection(context, 'songsWithDetails', tracks);
    context.commit('setPreviewReady');
  }

  async function loadSongs(context) {
    const result = await api.userLikedSongsIDs(context.state.user.userId);
    if (!Array.isArray(result?.ids)) throw new Error('Liked songs unavailable');
    if (result.ids) setCollection(context, 'songs', result.ids);
  }

  async function loadCollection(context, name, endpoint, limit) {
    const result = await api[endpoint]({ limit });
    if (!Array.isArray(result?.data)) throw new Error('Collection unavailable');
    setCollection(context, name, result.data);
  }

  async function loadHistory(context) {
    const result = await Promise.all(
      [0, 1].map(type =>
        api.userPlayHistory({ uid: context.state.user.userId, type })
      )
    );
    const data = {};
    ['allData', 'weekData'].forEach((name, index) => {
      data[name] = result[index][name].map(item => ({
        ...item.song,
        playCount: item.playCount,
      }));
    });
    setCollection(context, 'playHistory', data);
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
    const collection = context.state.collections[name];
    setCollection(
      context,
      name,
      favorite
        ? collection.map(item =>
            Number(item.id) === Number(id)
              ? { ...item, subscribed: true }
              : item
          )
        : collection.filter(item => Number(item.id || item.vid) !== Number(id))
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
          () => [
            () => updateFavoriteCollection(context, 'playlists', id, false),
            () => detailChange(context, id, 'deleted'),
            () => loadPlaylists(context),
          ]
        );
      },
      uploadCloudTrack(context, file) {
        return write(
          context,
          () => api.uploadSong(file),
          response => [
            () => {
              const track =
                response?.body?.privateCloud || response?.privateCloud;
              if (track)
                setCollection(context, 'cloudDisk', [
                  track,
                  ...context.state.collections.cloudDisk.filter(
                    item => item.songId !== track.songId
                  ),
                ]);
            },
            () => loadCollection(context, 'cloudDisk', 'cloudDisk', 1000),
          ]
        );
      },
      deleteCloudTrack(context, id) {
        return write(
          context,
          () => api.cloudDiskTrackDelete(id),
          () => [
            () =>
              setCollection(
                context,
                'cloudDisk',
                context.state.collections.cloudDisk.filter(
                  track => Number(track.songId) !== Number(id)
                )
              ),
            () => loadCollection(context, 'cloudDisk', 'cloudDisk', 1000),
          ]
        );
      },
      setPlaylistFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.subscribePlaylist({ id, t: favorite ? 1 : 2 }),
          () => [
            () => updateFavoriteCollection(context, 'playlists', id, favorite),
            () => detailChange(context, id, 'favorite', { favorite }),
            () => loadPlaylists(context),
          ]
        );
      },
      async removePlaylistTracks(context, { playlistId, trackIds }) {
        if (!context.rootGetters['session/hasAccount'])
          return changeResult(accountRequired);
        const outcome = await performLibraryWrite(() =>
          api.addOrRemoveTrackFromPlaylist({
            op: 'del',
            pid: playlistId,
            tracks: trackIds.join(','),
          })
        );
        if (outcome.status !== 'succeeded') return changeResult(outcome);
        const attempts = [
          () =>
            context.dispatch(
              'playlistDetail/applyLibraryChange',
              { type: 'tracks-removed', playlistId, trackIds },
              { root: true }
            ),
          () => loadPlaylists(context),
        ];
        if (Number(playlistId) === Number(context.state.likedSongPlaylistID)) {
          const removed = new Set(trackIds);
          attempts.push(
            () =>
              setCollection(
                context,
                'songs',
                context.state.collections.songs.filter(id => !removed.has(id))
              ),
            () =>
              setCollection(
                context,
                'songsWithDetails',
                context.state.collections.songsWithDetails.filter(
                  track => !removed.has(track.id)
                )
              ),
            () => loadSongs(context),
            () => loadPreview(context)
          );
        }
        return changeResult(outcome, await synchronize(attempts));
      },
      async changePlaylistTracks(context, params) {
        if (!context.rootGetters['session/hasAccount'])
          return changeResult(accountRequired);
        const result = await api.addOrRemoveTrackFromPlaylist(params);
        if (result.body?.code === 200) {
          const affectsLikedSongs =
            Number(params.pid) === Number(context.state.likedSongPlaylistID);
          await loadPlaylists(context);
          if (affectsLikedSongs) {
            await loadSongs(context);
            await loadPreview(context);
          }
        }
        return result;
      },
      async createPlaylist(context, { name, privacy = false, trackID }) {
        if (!context.rootGetters['session/hasAccount'])
          return changeResult(accountRequired);
        const result = await api.createPlaylist({
          name,
          privacy: privacy ? 10 : 0,
        });
        if (result.code !== 200) return result;
        let trackResult;
        if (trackID) {
          trackResult = await api.addOrRemoveTrackFromPlaylist({
            op: 'add',
            pid: result.id,
            tracks: trackID,
          });
        }
        await loadPlaylists(context);
        return { ...result, trackResult };
      },
      setAlbumFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.likeAAlbum({ id, t: favorite ? 1 : 0 }),
          () => [
            () => updateFavoriteCollection(context, 'albums', id, favorite),
            () => loadCollection(context, 'albums', 'likedAlbums', 2000),
          ]
        );
      },
      setArtistFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.followAArtist({ id, t: favorite ? 1 : 0 }),
          () => [
            () => updateFavoriteCollection(context, 'artists', id, favorite),
            () => loadCollection(context, 'artists', 'likedArtists', 2000),
          ]
        );
      },
      setMVFavorite(context, { id, favorite }) {
        return write(
          context,
          () => api.likeAMV({ mvid: id, t: favorite ? 1 : 0 }),
          () => [
            () => updateFavoriteCollection(context, 'mvs', id, favorite),
            () => loadCollection(context, 'mvs', 'likedMVs', 1000),
          ]
        );
      },
      toggleTrackFavorite(context, id) {
        const like = !context.state.collections.songs.includes(id);
        return write(
          context,
          () => api.likeATrack({ id, like }),
          () => {
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
              () =>
                setCollection(
                  context,
                  'songs',
                  like
                    ? [...context.state.collections.songs, id]
                    : context.state.collections.songs.filter(
                        song => song !== id
                      )
                ),
              () => {
                if (!like)
                  setCollection(
                    context,
                    'songsWithDetails',
                    context.state.collections.songsWithDetails.filter(
                      track => track.id !== id
                    )
                  );
              },
              async () => {
                await identifyPlaylist();
                await loadPreview(context);
              },
              async () => {
                const playlistId = await identifyPlaylist();
                if (!like)
                  await detailChange(context, playlistId, 'tracks-removed', {
                    trackIds: [id],
                  });
                await detailChange(context, playlistId, 'reload');
              },
            ];
          }
        );
      },
      loadApplication: context => loadLibrary(context, false),
      loadPage: context => loadLibrary(context, true),
      async refreshPlaylists(context) {
        if (!context.rootGetters['session/hasLibraryIdentity']) return;
        await loadPlaylists(context);
        await loadPreview(context);
      },
    },
  };
}
