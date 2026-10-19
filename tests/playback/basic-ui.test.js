import Vue from 'vue';
import Vuex from 'vuex';
import { shallowMount, createLocalVue } from '@vue/test-utils';
import DailyTracksCard from '@/components/DailyTracksCard.vue';
import { createPlayback } from '@/playback';
import Player from '@/components/Player.vue';
import TrackList from '@/components/TrackList.vue';
import DailyTracks from '@/views/dailyTracks.vue';
import { createStore } from '@/store';
import router from '@/router';

jest.mock('@/assets/css/slider.css', () => ({}));

jest.mock('@/utils/request', () => ({ __esModule: true, default: jest.fn() }));

const localVue = createLocalVue();
localVue.use(Vuex);
const tracks = [1, 2].map(id => ({
  id,
  name: `Track ${id}`,
  ar: [{ id: 10, name: 'Artist' }],
  al: { id: 20, name: 'Album', picUrl: '' },
  dt: 180000,
}));

function fixture() {
  const playback = createPlayback({
    getTrack: async id => tracks.find(track => track.id === id),
    resources: {
      resolve: async () => ({
        kind: 'url',
        url: '/audio.mp3',
        sourceInfo: { from: 'netease' },
      }),
      prefetch: async () => {},
    },
    audio: {
      async prepare(resource, options) {
        let position = options.position || 0;
        const handle = {
          play: () => options.onPlay(),
          pause: () => options.onPause(),
          seek: value => {
            position = value;
          },
          position: () => position,
          setVolume() {},
          applyOutputDevice() {},
          dispose() {},
        };
        if (options.autoplay) options.onPlay();
        return handle;
      },
    },
  });
  const store = new Vuex.Store({
    state: { player: playback, dailyTracks: tracks },
    getters: { 'session/hasAccount': () => true },
  });
  return { playback, store };
}

async function settled() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await Vue.nextTick();
}

test('daily card plays its existing IDs and retains the daily source', async () => {
  const { playback, store } = fixture();
  const wrapper = shallowMount(DailyTracksCard, {
    localVue,
    store,
    stubs: ['svg-icon'],
  });
  try {
    await wrapper.find('.play-button').trigger('click');
    await settled();
    expect(playback.state.currentTrack.id).toBe(1);
    expect(playback.state.playlistSource).toEqual({
      type: 'url',
      id: '/daily/songs',
    });
    await playback.next();
    expect(playback.state.currentTrack.id).toBe(2);
  } finally {
    wrapper.destroy();
    playback.dispose();
  }
});

test('playback bar renders replacement snapshots and controls seek, volume, mute and transport', async () => {
  const { playback } = fixture();
  const store = createStore();
  store.state.player = playback;
  await playback.playTracks([1, 2], {
    source: { type: 'url', id: '/daily/songs' },
  });
  const wrapper = shallowMount(Player, {
    localVue,
    store,
    router,
    mocks: { $t: key => key },
    filters: { resizeImage: value => value },
    stubs: ['svg-icon'],
  });
  try {
    expect(wrapper.find('.name').text()).toBe('Track 1');
    const sliders = wrapper.findAllComponents({ name: 'VueSlider' });
    sliders.at(0).vm.$emit('change', 42);
    sliders.at(1).vm.$emit('change', 0.35);
    await Vue.nextTick();
    expect(playback.position()).toBe(42);
    expect(sliders.at(0).props('value')).toBe(42);
    expect(playback.state.volume).toBe(0.35);
    await wrapper.find('[title="player.mute"]').trigger('click');
    expect(playback.state.volume).toBe(0);
    await wrapper.find('[title="player.mute"]').trigger('click');
    expect(playback.state.volume).toBe(0.35);
    await wrapper.find('[title="player.pause"]').trigger('click');
    expect(playback.state.playing).toBe(false);
    await wrapper.find('[title="player.play"]').trigger('click');
    expect(playback.state.playing).toBe(true);
    await wrapper.find('[title="player.next"]').trigger('click');
    await settled();
    expect(wrapper.find('.name').text()).toBe('Track 2');
  } finally {
    wrapper.destroy();
    playback.dispose();
  }
});

test.each([
  ['dailyTracks', 'playlist', { type: 'url', id: '/daily/songs' }],
  ['playAList', 'tracklist', { type: 'artist', id: 88 }],
  ['playCloudDisk', 'cloudDisk', { type: 'cloudDisk', id: 88 }],
  ['default', 'tracklist', { type: 'artist', id: 88 }],
])(
  'TrackList %s preserves the selected ID and collection source',
  async (dbclickTrackFunc, type, source) => {
    const { playback } = fixture();
    const store = createStore();
    store.state.player = playback;
    const wrapper = shallowMount(TrackList, {
      localVue,
      store,
      propsData: { tracks, id: 88, type, dbclickTrackFunc },
      mocks: { $t: key => key },
    });
    try {
      await wrapper
        .findAllComponents({ name: 'TrackListItem' })
        .at(1)
        .trigger('dblclick');
      await settled();
      expect(playback.state.currentTrackID).toBe(2);
      expect(playback.state.playlistSource).toEqual(source);
    } finally {
      wrapper.destroy();
      playback.dispose();
    }
  }
);

test('daily page plays loaded IDs without another source request', async () => {
  const { playback, store } = fixture();
  const wrapper = shallowMount(DailyTracks, {
    localVue,
    store,
    parentComponent: {
      beforeCreate() {
        this.$refs.main = { scrollTo() {} };
      },
    },
    mocks: { $t: key => key },
  });
  try {
    await wrapper.find('.play-button').trigger('click');
    await settled();
    expect(playback.state.currentTrackID).toBe(1);
    expect(playback.state.playlistSource).toEqual({
      type: 'url',
      id: '/daily/songs',
    });
  } finally {
    wrapper.destroy();
    playback.dispose();
  }
});
