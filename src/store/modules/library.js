export default function createLibrary(
  snapshot,
  { api = {}, notifyLikedSongsChanged = () => {} } = {}
) {
  const {
    likeATrack,
    getPlaylistDetail,
    getTrackDetail,
    userPlaylist,
    userPlayHistory,
    userLikedSongsIDs,
    likedAlbums,
    likedArtists,
    likedMVs,
    cloudDisk,
    userAccount,
  } = api;
  return {
    namespaced: true,
    state: () => ({
      ...snapshot,
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
        if (name === 'songs') notifyLikedSongsChanged();
      },
    },
    actions: {
      clearIdentity({ commit }) {
        commit('setUser', {});
        commit('setLikedSongPlaylistID', 0);
      },
      likeATrack({ state, commit, dispatch, rootGetters }, id) {
        if (!rootGetters['session/hasAccount']) {
          dispatch('showToast', '此操作需要登录网易云账号', { root: true });
          return;
        }
        let like = true;
        if (state.collections.songs.includes(id)) like = false;
        return likeATrack({ id, like })
          .then(() => {
            if (like === false) {
              commit('setCollection', {
                name: 'songs',
                data: state.collections.songs.filter(d => d !== id),
              });
            } else {
              let newLikeSongs = state.collections.songs;
              newLikeSongs.push(id);
              commit('setCollection', {
                name: 'songs',
                data: newLikeSongs,
              });
            }
            dispatch('fetchLikedSongsWithDetails');
          })
          .catch(() => {
            dispatch('showToast', '操作失败，专辑下架或版权锁定', {
              root: true,
            });
          });
      },
      fetchLikedSongs: ({ state, commit, rootGetters }) => {
        if (!rootGetters['session/hasLibraryIdentity']) return;
        if (rootGetters['session/hasAccount']) {
          return userLikedSongsIDs(state.user.userId).then(result => {
            if (result.ids) {
              commit('setCollection', {
                name: 'songs',
                data: result.ids,
              });
            }
          });
        } else {
          // TODO:搜索ID登录的用户
        }
      },
      fetchLikedSongsWithDetails: ({ state, commit }) => {
        return getPlaylistDetail(state.likedSongPlaylistID, true).then(
          result => {
            if (result.playlist?.trackIds?.length === 0) {
              return new Promise(resolve => {
                resolve();
              });
            }
            return getTrackDetail(
              result.playlist.trackIds
                .slice(0, 12)
                .map(t => t.id)
                .join(',')
            ).then(result => {
              commit('setCollection', {
                name: 'songsWithDetails',
                data: result.songs,
              });
            });
          }
        );
      },
      fetchLikedPlaylist: ({ state, commit, rootGetters }) => {
        if (!rootGetters['session/hasLibraryIdentity']) return;
        if (rootGetters['session/hasAccount']) {
          return userPlaylist({
            uid: state.user?.userId,
            limit: 2000, // 最多只加载2000个歌单（等有用户反馈问题再修）
            timestamp: new Date().getTime(),
          }).then(result => {
            if (result.playlist) {
              commit('setCollection', {
                name: 'playlists',
                data: result.playlist,
              });
              // 更新用户”喜欢的歌曲“歌单ID
              commit('setLikedSongPlaylistID', result.playlist[0]?.id || 0);
            }
          });
        } else {
          // TODO:搜索ID登录的用户
        }
      },
      fetchLikedAlbums: ({ commit, rootGetters }) => {
        if (!rootGetters['session/hasAccount']) return;
        return likedAlbums({ limit: 2000 }).then(result => {
          if (result.data) {
            commit('setCollection', {
              name: 'albums',
              data: result.data,
            });
          }
        });
      },
      fetchLikedArtists: ({ commit, rootGetters }) => {
        if (!rootGetters['session/hasAccount']) return;
        return likedArtists({ limit: 2000 }).then(result => {
          if (result.data) {
            commit('setCollection', {
              name: 'artists',
              data: result.data,
            });
          }
        });
      },
      fetchLikedMVs: ({ commit, rootGetters }) => {
        if (!rootGetters['session/hasAccount']) return;
        return likedMVs({ limit: 1000 }).then(result => {
          if (result.data) {
            commit('setCollection', {
              name: 'mvs',
              data: result.data,
            });
          }
        });
      },
      fetchCloudDisk: ({ commit, rootGetters }) => {
        if (!rootGetters['session/hasAccount']) return;
        // FIXME: #1242
        return cloudDisk({ limit: 1000 }).then(result => {
          if (result.data) {
            commit('setCollection', {
              name: 'cloudDisk',
              data: result.data,
            });
          }
        });
      },
      fetchPlayHistory: ({ state, commit, rootGetters }) => {
        if (!rootGetters['session/hasAccount']) return;
        return Promise.all([
          userPlayHistory({ uid: state.user?.userId, type: 0 }),
          userPlayHistory({ uid: state.user?.userId, type: 1 }),
        ]).then(result => {
          const data = {};
          const dataType = { 0: 'allData', 1: 'weekData' };
          if (result[0] && result[1]) {
            for (let i = 0; i < result.length; i++) {
              const songData = result[i][dataType[i]].map(item => {
                const song = item.song;
                song.playCount = item.playCount;
                return song;
              });
              data[[dataType[i]]] = songData;
            }
            commit('setCollection', {
              name: 'playHistory',
              data: data,
            });
          }
        });
      },
      fetchUserProfile: ({ commit, rootGetters }) => {
        if (!rootGetters['session/hasAccount']) return;
        return userAccount().then(result => {
          if (result.code === 200) {
            commit('setUser', result.profile);
          }
        });
      },
    },
  };
}
