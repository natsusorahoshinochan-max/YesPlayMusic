import 'fake-indexeddb/auto';
import Vue from 'vue';
import { mount } from '@vue/test-utils';
import Card from '@/components/DailyTracksCard.vue';
import Page from '@/views/dailyTracks.vue';
import { createStore } from '@/store';
import { createPlayback } from '@/playback';
import request, { configureRequest } from '@/utils/request';
import { configureMetadataReads } from '@/api/readingContext';
['resizeImage', 'formatTime'].forEach(name => Vue.filter(name, x => x));
const track = id => ({
  id,
  name: `Song ${id}`,
  dt: 1000,
  ar: [{ name: 'Artist' }],
  al: { id: 1, name: 'Album' },
  alia: [],
  playable: true,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await Vue.nextTick();
};
function setup({
  userAccount = async () => ({ code: 200, profile: { userId: 2 } }),
  getTrack = async id => track(id),
} = {}) {
  const values = new Map([
    ['data', JSON.stringify({ loginMode: 'account', user: { userId: 1 } })],
  ]);
  let credential = 'A';
  const store = createStore({
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
    credentials: {
      get: () => credential,
      set: value => {
        credential = value;
      },
      remove: () => {
        credential = null;
      },
    },
    session: {
      auth: { loginWithEmail: async () => ({ code: 200, cookie: 'B' }) },
    },
    library: {
      api: {
        userAccount,
        userLikedSongsIDs: async () => ({ ids: [] }),
        userPlaylist: async () => ({ playlist: [] }),
        likedAlbums: async () => ({ data: [] }),
        likedArtists: async () => ({ data: [] }),
        likedMVs: async () => ({ data: [] }),
        cloudDisk: async () => ({ data: [] }),
        userPlayHistory: async () => ({ weekData: [], allData: [] }),
      },
    },
  });
  const playback = createPlayback({
    getTrack,
    resources: {
      resolve: async () => ({ kind: 'url', url: 'https://audio/test' }),
    },
    audio: {
      prepare: async (_, cb) => ({
        play: () => cb.onPlay(),
        pause: () => cb.onPause(),
        position: () => 0,
        dispose() {},
        setVolume() {},
      }),
    },
    setInterval: () => 0,
    clearInterval() {},
  });
  store.state.player = playback;
  configureMetadataReads({
    getIdentity: () => ({ hasAccount: store.getters['session/hasAccount'] }),
  });
  configureRequest({
    getSettings: () => ({}),
    getCookie: () => credential,
    onSessionInvalid: () => store.dispatch('session/invalidate'),
    environment: { baseURL: '', configure: c => c },
  });
  let reads = 0;
  const response = deferred();
  request.defaults.adapter = async config => {
    reads++;
    return {
      config,
      status: 200,
      headers: {},
      data: await response.promise.catch(error => {
        error.config = config;
        throw error;
      }),
    };
  };
  const options = {
    store,
    mocks: { $t: x => x, $router: { push() {} } },
    stubs: [
      'ContextMenu',
      'ArtistsInLine',
      'ExplicitSymbol',
      'svg-icon',
      'router-link',
    ],
    filters: { resizeImage: x => x, formatTime: x => x },
  };
  const card = mount(Card, options);
  const page = mount(Page, {
    ...options,
    parentComponent: {
      beforeCreate() {
        this.$refs.main = { scrollTo() {} };
      },
    },
  });
  return {
    store,
    playback,
    response,
    card,
    page,
    reads: () => reads,
    dispose() {
      card.destroy();
      page.destroy();
      playback.dispose();
    },
  };
}
function songs(ids) {
  return {
    data: {
      dailySongs: ids.map(track),
      privileges: ids.map(id => ({ id, pl: 320000 })),
    },
  };
}
test.each(['double click', 'button'])(
  'card and page share one load and %s row/card/page play the same loaded snapshot with selected starts',
  async interaction => {
    const s = setup();
    await settle();
    expect(s.reads()).toBe(1);
    s.response.resolve(songs([1, 2, 3]));
    await settle();
    expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(3);
    const row = s.page.findAllComponents({ name: 'TrackListItem' }).at(1);
    if (interaction === 'button')
      await row.find('button.play-track').trigger('click');
    else await row.trigger('dblclick');
    await settle();
    expect(s.playback.state.currentTrackID).toBe(2);
    expect(s.playback.state.playlistSource).toEqual({
      type: 'url',
      id: '/daily/songs',
    });
    expect(s.playback.upcoming(10).map(x => x.trackId)).toEqual([3]);
    await s.card.find('button').trigger('click');
    await settle();
    expect(s.playback.state.currentTrackID).toBe(1);
    await s.page.find('.play-button').trigger('click');
    await settle();
    expect(s.playback.state.currentTrackID).toBe(1);
    expect(s.reads()).toBe(1);
    s.dispose();
  }
);

test('a legitimate empty response remains loaded when card and page ask again', async () => {
  const s = setup();
  s.response.resolve(songs([]));
  await settle();
  await s.card.vm.loadDailyTracks();
  await s.page.vm.loadDailyTracks();
  expect(s.store.state.dailyRecommendations.status).toBe('loaded');
  expect(s.page.isVisible()).toBe(true);
  expect(s.reads()).toBe(1);
  s.dispose();
});

test.each(['switch account', 'logout'])(
  'late daily success cannot return after %s through real session assembly',
  async change => {
    const s = setup();
    await settle();
    if (change === 'logout') await s.store.dispatch('session/logout');
    else
      await s.store.dispatch('session/loginWithPassword', {
        mode: 'email',
        email: 'b@example.com',
        password: 'password',
      });
    s.response.resolve(songs([1, 2]));
    await settle();
    expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(0);
    expect(s.store.state.dailyRecommendations.status).toBe('idle');
    s.dispose();
  }
);

test.each(['switch account', 'logout'])(
  'stale authorization failure has no effects after %s',
  async change => {
    const s = setup();
    await settle();
    if (change === 'logout') await s.store.dispatch('session/logout');
    else
      await s.store.dispatch('session/loginWithPassword', {
        mode: 'email',
        email: 'b@example.com',
        password: 'password',
      });
    s.response.reject({
      config: { url: '/recommend/songs' },
      response: { data: { code: 301, msg: '需要登录' } },
    });
    await settle();
    expect(s.store.getters['session/hasAccount']).toBe(change !== 'logout');
    expect(s.store.state.toast.show).toBe(false);
    expect(s.store.state.dailyRecommendations.status).toBe('idle');
    expect(s.store.state.dailyRecommendations.error).toBeNull();
    s.dispose();
  }
);

test('unavailable data ends loading and the page can retry instead of adopting an empty success', async () => {
  const s = setup();
  s.response.resolve(undefined);
  await settle();
  expect(s.store.state.dailyRecommendations.status).toBe('error');
  expect(s.page.find('button.retry').exists()).toBe(true);
  request.defaults.adapter = async config => ({
    config,
    status: 200,
    headers: {},
    data: songs([4]),
  });
  await s.page.find('button.retry').trigger('click');
  await settle();
  expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(1);
  expect(s.store.state.dailyRecommendations.status).toBe('loaded');
  s.dispose();
});

test('switching account retires daily work before the delayed new profile arrives', async () => {
  const profile = deferred();
  const s = setup({ userAccount: () => profile.promise });
  await settle();
  const switching = s.store.dispatch('session/loginWithPassword', {
    mode: 'email',
    email: 'b@example.com',
    password: 'password',
  });
  await settle();
  expect(s.store.getters['library/user'].userId).toBe(1);
  expect(s.store.getters['session/hasAccount']).toBe(true);
  s.response.reject({ response: { data: { code: 301, msg: '需要登录' } } });
  await settle();
  expect(s.store.getters['session/hasAccount']).toBe(true);
  expect(s.store.state.dailyRecommendations.status).toBe('idle');
  profile.resolve({ code: 200, profile: { userId: 2 } });
  await switching;
  s.dispose();
});

test('old completion cannot settle a new account load or replace its recommendation snapshot', async () => {
  const s = setup();
  await settle();
  await s.store.dispatch('session/loginWithPassword', {
    mode: 'email',
    email: 'b@example.com',
    password: 'password',
  });
  const next = deferred();
  request.defaults.adapter = async config => ({
    config,
    status: 200,
    headers: {},
    data: await next.promise,
  });
  const loading = s.page.vm.loadDailyTracks();
  await settle();
  s.response.resolve(songs([1]));
  await settle();
  expect(s.store.state.dailyRecommendations.status).toBe('loading');
  expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(0);
  next.resolve(songs([4, 5]));
  await loading;
  await settle();
  await s.card.find('button').trigger('click');
  await settle();
  expect(s.playback.state.currentTrackID).toBe(4);
  expect(s.playback.upcoming(10).map(x => x.trackId)).toEqual([5]);
  await s.store.dispatch('session/logout');
  await settle();
  expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(0);
  s.dispose();
});

test('a daily row waiting on audio metadata cannot take playback from a later selection', async () => {
  const metadata = deferred();
  const s = setup({
    getTrack: id => (id === 2 ? metadata.promise : Promise.resolve(track(id))),
  });
  s.response.resolve(songs([1, 2, 3]));
  await settle();
  await s.page
    .findAllComponents({ name: 'TrackListItem' })
    .at(1)
    .trigger('dblclick');
  await settle();
  await s.playback.playTracks([9], { source: { type: 'url', id: '/other' } });
  metadata.resolve(track(2));
  await settle();
  expect(s.playback.state.currentTrackID).toBe(9);
  expect(s.playback.state.playlistSource).toEqual({
    type: 'url',
    id: '/other',
  });
  s.dispose();
});

test('registering the daily owner starts no request and constructs no player', async () => {
  let reads = 0;
  request.defaults.adapter = async () => {
    reads++;
    throw new Error('Unexpected request');
  };
  const store = createStore({ storage: { getItem: () => null, setItem() {} } });
  await settle();
  expect(reads).toBe(0);
  expect(store.state.player).toBeNull();
  expect(store.state.dailyRecommendations.status).toBe('idle');
});

test('an existing account snapshot clears immediately when replacing the account before profile loading', async () => {
  const profile = deferred();
  const s = setup({ userAccount: () => profile.promise });
  s.response.resolve(songs([1, 2]));
  await settle();
  expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(2);
  const switching = s.store.dispatch('session/loginWithPassword', {
    mode: 'email',
    email: 'b@example.com',
    password: 'password',
  });
  await settle();
  expect(s.store.getters['library/user'].userId).toBe(1);
  expect(s.page.findAllComponents({ name: 'TrackListItem' })).toHaveLength(0);
  profile.resolve({ code: 200, profile: { userId: 2 } });
  await switching;
  s.dispose();
});
