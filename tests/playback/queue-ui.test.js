import 'fake-indexeddb/auto';
import Vue from 'vue';
import Vuex from 'vuex';
import { shallowMount, createLocalVue } from '@vue/test-utils';
import { createPlayback } from '@/playback';
import TrackList from '@/components/TrackList.vue';
import Next from '@/views/next.vue';
import FMCard from '@/components/FMCard.vue';
import request from '@/utils/request';
jest.mock('@/utils/request', () => ({ __esModule: true, default: jest.fn() }));
const localVue = createLocalVue();
localVue.use(Vuex);
localVue.filter('resizeImage', value => value);
const track = id => ({
  id,
  name: `Track ${id}`,
  ar: [{ name: 'Artist' }],
  al: { id: 1, picUrl: '' },
  dt: 180000,
});
const settled = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await Vue.nextTick();
};
function fixture() {
  const p = createPlayback({
    getTrack: async id => track(id),
    resources: {
      resolve: async () => ({ kind: 'url', url: '/audio' }),
      prefetch: async () => {},
    },
    audio: {
      prepare: async (_, events) => ({
        play: () => events.onPlay(),
        pause: () => events.onPause(),
        position: () => 0,
        seek() {},
        setVolume() {},
        dispose() {},
      }),
    },
    personalFM: {
      load: async () => [track(7), track(8)],
      trash: async () => {},
    },
    setInterval: () => 1,
    clearInterval() {},
  });
  const store = new Vuex.Store({
    state: { player: p },
    getters: {
      'library/collections': () => ({ songs: [] }),
      'session/hasAccount': () => true,
    },
  });
  return { p, store };
}
const mocks = { $t: x => x };
test('upcoming page preserves duplicate occurrence positions through TrackList selection and removal', async () => {
  request.mockImplementation(async config => ({
    songs: config.params.ids.split(',').map(id => track(Number(id))),
    privileges: config.params.ids
      .split(',')
      .map(id => ({ id: Number(id), st: 0, pl: 320000, fee: 0 })),
  }));
  const { p, store } = fixture();
  await p.playTracks([1, 2, 1, 3]);
  p.enqueueNext(8);
  p.enqueueNext(8);
  const page = shallowMount(Next, { localVue, store, mocks });
  await page.vm.loadTracks();
  await settled();
  expect(page.vm.nextRows.map(row => row.index)).toEqual([0, 1]);
  expect(page.vm.mainRows.map(row => row.trackId)).toEqual([2, 1, 3]);
  const props = page.findAllComponents(TrackList).at(1).props();
  const list = shallowMount(TrackList, {
    localVue,
    store,
    mocks,
    propsData: props,
  });
  expect(await list.vm.playThisList(8, 1)).toEqual({ status: 'completed' });
  expect(p.upcoming(1)[0]).toEqual({ trackId: 8, group: 'next', index: 0 });
  await settled();
  await list.setProps({ queueEntries: page.vm.nextRows });
  list.vm.rightClickedTrackIndex = 0;
  list.vm.removeTrackFromQueue();
  expect(p.upcoming(1)[0].trackId).toBe(2);
  list.vm.rightClickedTrack = track(9);
  await list.vm.play();
  expect(p.state.currentTrackID).toBe(9);
  page.destroy();
  list.destroy();
  p.dispose();
});
test('FM card renders empty recommendations safely and controls the real FM playback snapshot', async () => {
  const { p, store } = fixture();
  const card = shallowMount(FMCard, {
    localVue,
    store,
    mocks,
    stubs: ['svg-icon'],
  });
  expect(card.vm.nextTrackCover).toBe('');
  expect(card.vm.track.id).toBe(0);
  await card.vm.play();
  await settled();
  expect(card.vm.track.id).toBe(7);
  expect(card.vm.isPlaying).toBe(true);
  await card.vm.next();
  await settled();
  expect(card.vm.track.id).toBe(8);
  card.destroy();
  p.dispose();
});
