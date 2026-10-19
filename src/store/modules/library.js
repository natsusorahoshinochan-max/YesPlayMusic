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
    if (result.data) setCollection(context, name, result.data);
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
      attempts.push(
        () => loadSongs(context),
        () => loadPreview(context)
      );
    }
    return attempts;
  }

  function requireAccount(context) {
    if (context.rootGetters['session/hasAccount']) return true;
    context.dispatch('showToast', '此操作需要登录网易云账号', { root: true });
    return false;
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
      async deletePlaylist(context, id) {
        if (!requireAccount(context)) return;
        const result = await api.deletePlaylist(id);
        if (result.code === 200) await loadPlaylists(context);
        return result;
      },
      async uploadCloudTrack(context, file) {
        if (!requireAccount(context) || !file) return;
        const result = await api.uploadSong(file);
        if (result?.code === 200) {
          setCollection(context, 'cloudDisk', [
            result.privateCloud,
            ...context.state.collections.cloudDisk,
          ]);
        }
        return result;
      },
      async deleteCloudTrack(context, id) {
        if (!requireAccount(context)) return;
        const result = await api.cloudDiskTrackDelete(id);
        if (result.code === 200) {
          setCollection(
            context,
            'cloudDisk',
            context.state.collections.cloudDisk.filter(
              track => track.songId !== id
            )
          );
        }
        return result;
      },
      async setPlaylistFavorite(context, { id, favorite }) {
        if (!requireAccount(context)) return;
        const result = await api.subscribePlaylist({ id, t: favorite ? 1 : 2 });
        if (result.code === 200) await loadPlaylists(context);
        return result;
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
      async addPlaylistTracks(context, { playlistId, trackIds }) {
        if (!context.rootGetters['session/hasAccount'])
          return changeResult(accountRequired);
        const outcome = await performLibraryWrite(() =>
          api.addOrRemoveTrackFromPlaylist({
            op: 'add',
            pid: playlistId,
            tracks: trackIds.join(','),
          })
        );
        if (outcome.status !== 'succeeded') return changeResult(outcome);
        return changeResult(
          outcome,
          await synchronize(trackAdditionUpdates(context, playlistId, trackIds))
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
        if (requested) {
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
      async setAlbumFavorite(context, { id, favorite }) {
        if (!requireAccount(context)) return;
        const result = await api.likeAAlbum({ id, t: favorite ? 1 : 0 });
        if (result.code === 200)
          await loadCollection(context, 'albums', 'likedAlbums', 2000);
        return result;
      },
      async setArtistFavorite(context, { id, favorite }) {
        if (!requireAccount(context)) return;
        const result = await api.followAArtist({ id, t: favorite ? 1 : 0 });
        if (result.code === 200)
          await loadCollection(context, 'artists', 'likedArtists', 2000);
        return result;
      },
      async setMVFavorite(context, { id, favorite }) {
        if (!requireAccount(context)) return;
        const result = await api.likeAMV({ mvid: id, t: favorite ? 1 : 0 });
        if (result.code === 200)
          await loadCollection(context, 'mvs', 'likedMVs', 1000);
        return result;
      },
      async toggleTrackFavorite(context, id) {
        if (!requireAccount(context)) return;
        const like = !context.state.collections.songs.includes(id);
        try {
          const result = await api.likeATrack({ id, like });
          if (result.code !== 200) return result;
          setCollection(
            context,
            'songs',
            like
              ? [...context.state.collections.songs, id]
              : context.state.collections.songs.filter(song => song !== id)
          );
          if (!context.state.likedSongPlaylistID) await loadPlaylists(context);
          await loadPreview(context);
          return result;
        } catch (error) {
          await context.dispatch('showToast', '操作失败，专辑下架或版权锁定', {
            root: true,
          });
        }
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
