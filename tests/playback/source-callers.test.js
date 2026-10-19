import Vue from 'vue';
import Vuex from 'vuex';
import { createLocalVue, shallowMount } from '@vue/test-utils';
import Cover from '@/components/Cover.vue';
import TrackList from '@/components/TrackList.vue';
import Playlist from '@/views/playlist.vue';
import Album from '@/views/album.vue';
import Artist from '@/views/artist.vue';
import Library from '@/views/library.vue';
import { createPlayback } from '@/playback';
import { createStore } from '@/store';

jest.mock('@/utils/request', () => ({ __esModule: true, default: jest.fn() }));
const localVue = createLocalVue();
localVue.use(Vuex);
const tracks = [11, 12].map(id => ({
  id,
  name: `Track ${id}`,
  ar: [],
  al: {},
  dt: 180000,
}));
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await Vue.nextTick();
};
function fixture() {
  const requests = [];
  const feedback = [];
  const load = type => async (id, options) => {
    requests.push([type, id, options]);
    return [11, 12];
  };
  const playback = createPlayback({
    sourceLists: {
      playlist: load('playlist'),
      album: load('album'),
      artist: load('artist'),
      intelligence: load('intelligence'),
    },
    getTrack: async id => tracks.find(track => track.id === id),
    resources: { resolve: async () => ({ kind: 'url', url: '/audio.mp3' }) },
    audio: {
      prepare: async (_, options) => ({
        play: options.onPlay,
        pause: options.onPause,
        position: () => 0,
        setVolume() {},
        seek() {},
        dispose() {},
      }),
    },
    onFeedback: event => feedback.push(event),
  });
  const store = createStore();
  store.state.player = playback;
  return { playback, store, requests, feedback };
}

test.each(['playlist', 'album', 'artist'])(
  'Cover %s button dispatches a complete source playback on the shared instance',
  async type => {
    const { playback, store } = fixture();
    const wrapper = shallowMount(Cover, {
      localVue,
      store,
      propsData: { id: 50, type, imageUrl: '' },
      stubs: ['svg-icon'],
    });
    try {
      await wrapper.find('.play-button').trigger('click');
      await settle();
      expect(playback.state.currentTrackID).toBe(11);
      expect(playback.state.playlistSource).toEqual({ type, id: 50 });
    } finally {
      wrapper.destroy();
      playback.dispose();
    }
  }
);

test.each([
  ['playlist', 'default'],
  ['album', 'default'],
  ['artist', 'default'],
  ['tracklist', 'playPlaylist'],
])(
  'TrackList %s/%s double click requests its source and chosen start on the shared instance',
  async (type, dbclickTrackFunc) => {
    const { playback, store, requests } = fixture();
    const wrapper = shallowMount(TrackList, {
      localVue,
      store,
      propsData: { tracks, id: 50, type, dbclickTrackFunc },
      mocks: { $t: key => key },
    });
    try {
      await wrapper
        .findAllComponents({ name: 'TrackListItem' })
        .at(1)
        .trigger('dblclick');
      await settle();
      expect(playback.state.currentTrackID).toBe(12);
      expect(playback.state.playlistSource).toEqual({
        type: type === 'tracklist' ? 'playlist' : type,
        id: 50,
      });
      expect(requests).toHaveLength(1);
    } finally {
      wrapper.destroy();
      playback.dispose();
    }
  }
);

// Browsing lifecycle is outside this seam; hydrate its visible data directly.
// The rendered source buttons and their production handlers remain unchanged.
function mountSourceView(component, store, data = {}) {
  return shallowMount(
    { ...component, created: [], activated: [], watch: {} },
    {
      localVue,
      store,
      data: () => data,
      mocks: {
        $t: key => key,
        $route: { name: 'playlist', params: { id: '50' } },
      },
      filters: {
        resizeImage: value => value,
        formatDate: () => '',
        formatTime: () => '',
        formatAlbumType: () => '',
      },
      stubs: ['svg-icon', 'router-link', 'ContextMenu'],
    }
  );
}

test.each([
  ['playlist', Playlist],
  ['album', Album],
  ['artist', Artist],
])(
  '%s page play button resolves its full source using the store instance',
  async (type, component) => {
    const { playback, store, requests } = fixture();
    store.state.playlistDetail.current = {
      playlist: { id: 50, creator: {}, trackIds: [{ id: 99 }] },
      tracks: [],
    };
    const wrapper = mountSourceView(component, store, {
      album: { id: 50, picUrl: '', artist: {} },
      artist: { id: 50 },
      latestRelease: undefined,
    });
    try {
      await wrapper
        .findAllComponents({ name: 'ButtonTwoTone' })
        .at(0)
        .trigger('click');
      await settle();
      expect(playback.state.currentTrackID).toBe(11);
      expect(playback.state.playlistSource).toEqual({ type, id: 50 });
      expect(requests).toHaveLength(1);
    } finally {
      wrapper.destroy();
      playback.dispose();
    }
  }
);

test('library liked and intelligence menu entries use fresh list reads on the same instance', async () => {
  const { playback, store, requests } = fixture();
  store.state.library.collections.playlists = [{ id: 50 }];
  const wrapper = mountSourceView(Library, store);
  try {
    const entries = wrapper.findAll('.item');
    const liked = entries.wrappers.find(
      item => item.text() === 'library.likedSongs'
    );
    const intelligence = entries.wrappers.find(
      item => item.text() === 'contextMenu.cardiacMode'
    );
    await liked.trigger('click');
    await settle();
    expect(playback.state.currentTrackID).toBe(11);
    await intelligence.trigger('click');
    await settle();
    expect(requests.slice(0, 2)).toEqual([
      ['playlist', 50, { fresh: true }],
      ['playlist', 50, { fresh: true }],
    ]);
    expect(requests[2][0]).toBe('intelligence');
    expect(playback.state.playlistSource).toEqual({ type: 'playlist', id: 50 });
  } finally {
    wrapper.destroy();
    playback.dispose();
  }
});
