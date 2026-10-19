import 'fake-indexeddb/auto';
import Album from '@/views/album.vue';
import request, { configureRequest } from '@/utils/request';
import { configureMetadataReads } from '@/api/readingContext';
import Vue from 'vue';
import Vuex from 'vuex';
import { mount } from '@vue/test-utils';
import Next from '@/views/next.vue';
import Library from '@/views/library.vue';
import Playlist from '@/views/playlist.vue';
import createPlaylistDetail from '@/store/modules/playlistDetail';
import { createPlayback } from '@/playback';

Vue.use(Vuex);
['resizeImage', 'formatTime', 'formatDate', 'formatNumber'].forEach(name =>
  Vue.filter(name, x => x)
);
const track = id => ({
  id,
  name: `Track ${id}`,
  dt: 1000,
  ar: [{ name: 'Artist' }],
  al: { id: 1, name: 'Album' },
  alia: [],
  playable: true,
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await Vue.nextTick();
};
function setup() {
  const playback = createPlayback({
    getTrack: async id => track(id),
    sourceLists: {
      playlist: async () => [1, 2, 3],
      album: async () => [1, 2, 3],
    },
    resources: {
      resolve: async () => ({ kind: 'url', url: 'https://audio/test' }),
    },
    audio: {
      prepare: async (_, callbacks) => ({
        play: () => callbacks.onPlay(),
        pause: () => callbacks.onPause(),
        position: () => 0,
        dispose() {},
        setVolume() {},
      }),
    },
    setInterval: () => 0,
    clearInterval() {},
  });
  const store = new Vuex.Store({
    state: { player: playback },
    getters: {
      'library/collections': () => ({ songs: [] }),
      'preferences/settings': () => ({ subTitleDefault: true }),
    },
  });
  return { playback, store };
}
function page(store) {
  return mount(Next, {
    store,
    data: () => ({ tracks: [track(1), track(2), track(3)] }),
    mocks: { $t: x => x },
    stubs: [
      'ContextMenu',
      'ArtistsInLine',
      'ExplicitSymbol',
      'svg-icon',
      'router-link',
    ],
    filters: { resizeImage: x => x, formatTime: x => x },
  });
}
test.each(['button', 'double click'])(
  '%s selects the second repeated main queue record through the real page and row',
  async interaction => {
    const { playback, store } = setup();
    await playback.playTracks([1, 2, 2, 3], {
      source: { type: 'playlist', id: 7 },
    });
    const wrapper = page(store);
    const row = wrapper
      .findAllComponents({ name: 'TrackList' })
      .at(2)
      .findAllComponents({ name: 'TrackListItem' })
      .at(1);
    if (interaction === 'button')
      await row.find('button.play-track').trigger('click');
    else await row.trigger('dblclick');
    await settle();
    expect(playback.state.currentTrackID).toBe(2);
    expect(playback.state.playing).toBe(true);
    expect(playback.state.playlistSource).toEqual({ type: 'playlist', id: 7 });
    expect(playback.upcoming(10).map(item => item.trackId)).toEqual([3]);
    wrapper.destroy();
    playback.dispose();
  }
);

test('filtering a real playlist page preserves its full Playback source', async () => {
  const { playback, store } = setup();
  store.registerModule(
    'playlistDetail',
    createPlaylistDetail({
      api: {
        getPlaylistDetail: async id => ({
          playlist: {
            id,
            name: 'Playlist',
            creator: { userId: 9 },
            trackCount: 3,
            trackIds: [1, 2, 3].map(id => ({ id })),
            tracks: [1, 2, 3].map(track),
          },
        }),
        getTrackDetail: async () => ({ songs: [] }),
      },
    })
  );
  store.hotUpdate({
    getters: {
      ...store._modules.root._rawModule.getters,
      'library/user': () => ({ userId: 1 }),
      'library/likedSongPlaylistID': () => 0,
    },
  });
  const wrapper = mount(Playlist, {
    store,
    mocks: { $t: x => x, $route: { params: { id: 7 }, name: 'playlist' } },
    stubs: [
      'Cover',
      'Modal',
      'ContextMenu',
      'ButtonTwoTone',
      'ArtistsInLine',
      'ExplicitSymbol',
      'svg-icon',
      'router-link',
    ],
  });
  await settle();
  await wrapper.setData({ searchKeyWords: 'Track 2' });
  expect(wrapper.findAllComponents({ name: 'TrackListItem' })).toHaveLength(1);
  await wrapper.findComponent({ name: 'TrackListItem' }).trigger('dblclick');
  await settle();
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.playlistSource).toEqual({ type: 'playlist', id: 7 });
  expect(playback.upcoming(10).map(item => item.trackId)).toEqual([3]);
  wrapper.destroy();
  playback.dispose();
});

test('a second disc row plays from the complete album source', async () => {
  const { playback, store } = setup();
  configureMetadataReads({ getIdentity: () => ({ hasAccount: false }) });
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => null,
    onSessionInvalid() {},
    environment: { baseURL: '', configure: config => config },
  });
  const songs = [1, 2, 3].map(id => ({
    ...track(id),
    cd: id === 1 ? '01' : '02',
    privilege: { pl: 320000 },
  }));
  request.defaults.adapter = async config => ({
    config,
    status: 200,
    headers: {},
    data:
      config.url === '/album'
        ? {
            album: { id: 8, name: 'Album', artist: { id: 9, name: 'Artist' } },
            songs,
          }
        : config.url === '/song/detail'
        ? { songs, privileges: songs.map(t => ({ id: t.id, pl: 320000 })) }
        : config.url === '/artist/album'
        ? { hotAlbums: [] }
        : {},
  });
  const wrapper = mount(Album, {
    store,
    mocks: { $t: x => x, $route: { params: { id: 8 } } },
    stubs: [
      'Cover',
      'CoverRow',
      'Modal',
      'ContextMenu',
      'ButtonTwoTone',
      'ArtistsInLine',
      'ExplicitSymbol',
      'svg-icon',
      'router-link',
    ],
  });
  for (
    let i = 0;
    i < 10 && wrapper.findAllComponents({ name: 'TrackListItem' }).length < 3;
    i++
  )
    await new Promise(resolve => setTimeout(resolve, 10));
  const list = wrapper.findAllComponents({ name: 'TrackList' }).at(1);
  await list
    .findAllComponents({ name: 'TrackListItem' })
    .at(0)
    .find('button.play-track')
    .trigger('click');
  await settle();
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.playlistSource).toEqual({ type: 'album', id: 8 });
  expect(playback.upcoming(10).map(item => item.trackId)).toEqual([3]);
  wrapper.destroy();
  playback.dispose();
});

test('the cloud disk page explicitly hands off songId and its complete collection', async () => {
  const { playback, store } = setup();
  const cloudDisk = [2, 3].map(id => ({
    songId: id,
    songName: `Cloud ${id}`,
    simpleSong: track(id),
  }));
  const collections = {
    songs: [],
    songsWithDetails: [],
    playlists: [],
    albums: [],
    artists: [],
    mvs: [],
    cloudDisk,
    playHistory: { weekData: [], allData: [] },
  };
  store.hotUpdate({
    getters: {
      ...store._modules.root._rawModule.getters,
      'library/collections': () => collections,
      'library/user': () => ({ userId: 1 }),
      'library/previewReady': () => true,
      'preferences/libraryPlaylistFilter': () => 'all',
    },
  });
  const wrapper = mount(Library, {
    store,
    data: () => ({ show: true, currentTab: 'cloudDisk' }),
    mocks: { $t: x => x },
    stubs: [
      'CoverRow',
      'MvRow',
      'ContextMenu',
      'ArtistsInLine',
      'ExplicitSymbol',
      'svg-icon',
      'router-link',
    ],
  });
  await wrapper
    .findAllComponents({ name: 'TrackList' })
    .at(1)
    .findAllComponents({ name: 'TrackListItem' })
    .at(0)
    .trigger('dblclick');
  await settle();
  expect(playback.state.currentTrackID).toBe(2);
  expect(playback.state.playlistSource).toEqual({ type: 'cloudDisk', id: -8 });
  expect(playback.upcoming(10).map(item => item.trackId)).toEqual([3]);
  wrapper.destroy();
  playback.dispose();
});

test.each(['button', 'double click'])(
  '%s consumes only the selected repeated next entry and keeps the main queue position',
  async interaction => {
    const { playback, store } = setup();
    await playback.playTracks([1, 2, 3]);
    playback.enqueueNext(2);
    playback.enqueueNext(2);
    playback.enqueueNext(3);
    const wrapper = page(store);
    const row = wrapper
      .findAllComponents({ name: 'TrackList' })
      .at(1)
      .findAllComponents({ name: 'TrackListItem' })
      .at(1);
    if (interaction === 'button')
      await row.find('button.play-track').trigger('click');
    else await row.trigger('dblclick');
    await settle();
    expect(playback.state.currentTrackID).toBe(2);
    expect(playback.state.playing).toBe(true);
    expect(playback.upcoming(10)).toEqual([
      { trackId: 2, group: 'next', index: 0 },
      { trackId: 3, group: 'next', index: 1 },
      { trackId: 2, group: 'main', index: 1 },
      { trackId: 3, group: 'main', index: 2 },
    ]);
    wrapper.destroy();
    playback.dispose();
  }
);
