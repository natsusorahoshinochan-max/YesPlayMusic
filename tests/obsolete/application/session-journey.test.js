/* eslint-env jest */
// The database driver is a storage boundary; cache and endpoint code stay real.
jest.mock('dexie', () => {
  class MemoryDatabase {
    constructor() {
      for (const name of ['trackDetail', 'trackSources', 'lyric', 'album']) {
        const records = new Map();
        this[name] = {
          put: value => {
            records.set(value.id, JSON.parse(JSON.stringify(value)));
            return Promise.resolve(value.id);
          },
          get: id => Promise.resolve(records.get(id)),
          filter: predicate => ({
            toArray: () =>
              Promise.resolve([...records.values()].filter(predicate)),
          }),
        };
      }
    }
    version() {
      return { stores: () => ({ upgrade() {} }) };
    }
  }
  return MemoryDatabase;
});

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test.each([false, true])(
  'restored public identity enters an account, displays its library, favorites, exits and restarts independently (Electron: %s)',
  async isElectron => {
    const environment = process.env;
    const requireDesktop = window.require;
    let host;
    try {
      jest.resetModules();
      jest.useFakeTimers();
      process.env = { ...environment, IS_ELECTRON: isElectron };
      const send = jest.fn();
      window.require = () => ({ ipcRenderer: { send } });
      window.matchMedia = () => ({ matches: false, addEventListener() {} });
      document.head.innerHTML = '<meta name="theme-color" content="#fff">';
      localStorage.clear();
      localStorage.setItem('appVersion', '"0.4.11"');
      localStorage.setItem(
        'data',
        JSON.stringify({
          loginMode: 'username',
          user: { userId: 19, nickname: 'Public library' },
          likedSongPlaylistID: 88,
          libraryPlaylistFilter: 'mine',
          futureData: { retain: 'unknown data' },
        })
      );
      localStorage.setItem(
        'settings',
        JSON.stringify({
          lang: 'zh-TW',
          appearance: 'dark',
          enableRealIP: true,
          realIP: '203.0.113.8',
          futureSetting: { retain: 'unknown setting' },
        })
      );
      localStorage.setItem('lastfm', '{"key":"independent-lastfm"}');
      localStorage.setItem('playerCurrentTrackTime', '42');
      localStorage.setItem(
        'player',
        JSON.stringify({
          _enabled: false,
          _list: [50, 51],
          _playNextList: [52],
          _currentTrack: { id: 50 },
        })
      );
      const { startApplication } = require('@/application/startup');
      const { createStore } = require('@/store');
      const { initializeLocale } = require('@/locale');
      const { initializeAppearance } = require('@/utils/appearance');
      const { createCredentials } = require('@/application/credentials');
      const {
        createRequestEnvironment,
      } = require('@/application/requestEnvironment');
      const { createSessionEffects } = require('@/application/sessionEffects');
      const { createPlayer } = require('@/application/player');
      const { libraryApi } = require('@/application/library');
      const auth = require('@/api/auth');
      const request = require('@/utils/request').default;
      const { configureRequest } = require('@/utils/request');
      const {
        cacheTrackDetail,
        getTrackDetailFromCache,
      } = require('@/utils/db');
      const { mount } = require('@vue/test-utils');
      const Library = require('@/views/library.vue').default;
      require('@/utils/filters');
      const track = id => ({ id, name: `Song ${id}`, fee: 0 });
      const accountPreview = deferred();
      const requests = [];
      let accountPreviewPending = true;
      let likedIDs = [51];
      request.defaults.adapter = async config => {
        requests.push(config);
        let data;
        switch (config.url) {
          case '/personal_fm':
            data = { data: [{ id: 60 }, { id: 61 }] };
            break;
          case '/login':
            data = {
              code: 200,
              cookie:
                'MUSIC_U=account-token; path=/;;__csrf=csrf-token; path=/',
            };
            break;
          case '/user/account':
            data = { code: 200, profile: { userId: 7, nickname: 'Account' } };
            break;
          case '/user/playlist':
            data = { playlist: [{ id: config.params.uid === 19 ? 88 : 20 }] };
            break;
          case '/playlist/detail':
            data = {
              playlist: {
                tracks: [],
                trackIds: (config.params.id === 88 ? [90] : likedIDs).map(
                  id => ({ id })
                ),
              },
            };
            break;
          case '/song/detail': {
            const ids = String(config.params.ids).split(',').map(Number);
            if (ids.includes(51) && accountPreviewPending)
              await accountPreview.promise;
            data = {
              songs: ids.map(track),
              privileges: ids.map(id => ({ id, pl: 320000 })),
            };
            break;
          }
          case '/likelist':
            data = { ids: likedIDs };
            break;
          case '/like':
            likedIDs = [51, 50];
            data = { code: 200 };
            break;
          case '/user/record':
            data = { allData: [], weekData: [] };
            break;
          case '/lyric':
            data = { lrc: { lyric: '[00:00] Preview lyric' } };
            break;
          case '/logout':
          case '/login/refresh':
            data = { code: 200 };
            break;
          case '/album/sublist':
          case '/artist/sublist':
          case '/mv/sublist':
          case '/user/cloud':
            data = { data: [] };
            break;
          default:
            throw new Error(`Unexpected HTTP request: ${config.url}`);
        }
        return { config, status: 200, data };
      };
      const credentials = createCredentials();
      const router = {
        currentRoute: { name: 'home' },
        push: jest.fn(page => {
          router.currentRoute = page;
          return Promise.resolve();
        }),
      };
      let store;
      let libraryLoaded;
      const app = startApplication({
        createStore() {
          store = createStore({
            credentials,
            session: {
              auth,
              now: () => new Date(2026, 9, 19),
              ...createSessionEffects({ router, isElectron }),
            },
            library: {
              api: libraryApi,
              notifyLikedSongsChanged: () =>
                store.state.player?.sendSelfToIpcMain?.(),
            },
          });
          store.dispatch('session/restore');
          return store;
        },
        initializeLocale,
        initializeAppearance,
        configureRequest,
        requestEnvironment: createRequestEnvironment({
          isElectron,
          mode: 'production',
          webBaseURL: 'https://api.example.test',
          electronBaseURL: 'http://localhost:10754',
          forcedRealIP: '',
        }),
        getCookie: key => credentials.get(key),
        onSessionInvalid: () => store.dispatch('session/invalidate'),
        createPlayer,
        mount({ i18n }) {
          libraryLoaded = store.dispatch('library/loadApplication');
          return { i18n, player: store.state.player };
        },
      });
      await libraryLoaded;
      expect(app.i18n.locale).toBe('zh-TW');
      expect(document.body.getAttribute('data-theme')).toBe('dark');
      expect(app.player.list).toEqual([50, 51]);
      expect(app.player.playNextList).toEqual([52]);
      expect(app.player.currentTrackID).toBe(50);
      expect(requests[0]).toMatchObject({
        url: '/personal_fm',
        params: { realIP: '203.0.113.8' },
      });
      expect(store.getters['session/hasAccount']).toBe(false);
      expect(store.getters['session/hasLibraryIdentity']).toBe(true);
      expect(store.getters['library/collections'].songsWithDetails).toEqual([
        expect.objectContaining({ id: 90, name: 'Song 90' }),
      ]);
      expect(requests.some(config => config.url === '/user/account')).toBe(
        false
      );
      cacheTrackDetail(track(999), { id: 999, pl: 320000 });
      store.commit('preferences/updateSettings', {
        key: 'dynamicSetting',
        value: { enabled: true },
      });
      const entry = store.dispatch('session/loginWithPassword', {
        mode: 'email',
        email: 'listener@163.com',
        password: 'private-password',
      });
      await flush();
      expect(credentials.get('MUSIC_U')).toBe('account-token');
      expect(router.push).not.toHaveBeenCalled();
      accountPreviewPending = false;
      accountPreview.resolve();
      await entry;
      expect(router.push).toHaveBeenCalledWith({ name: 'library' });
      expect(store.getters['library/user'].nickname).toBe('Account');
      expect(store.getters['library/previewReady']).toBe(true);
      host = mount(
        {
          render(h) {
            return h('div', [
              h(
                { render: h => h('div'), methods: { restorePosition() {} } },
                { ref: 'scrollbar' }
              ),
              h('keep-alive', [h(Library)]),
            ]);
          },
        },
        {
          store,
          i18n: app.i18n,
          stubs: {
            TrackList: {
              name: 'TrackList',
              props: ['tracks'],
              render(h) {
                return h('div', this.tracks.map(track => track.name).join(','));
              },
            },
            CoverRow: true,
            MvRow: true,
            ContextMenu: true,
            SvgIcon: true,
          },
        }
      );
      await flush();
      await host.vm.$nextTick();
      const page = host.findComponent(Library);
      expect(page.isVisible()).toBe(true);
      expect(page.text()).toContain('Account');
      expect(page.findComponent({ name: 'TrackList' }).props('tracks')).toEqual(
        [expect.objectContaining({ id: 51, name: 'Song 51' })]
      );
      expect(page.text()).toContain('Song 51');
      expect(store.getters['library/collections'].songsWithDetails[0].id).toBe(
        51
      );
      send.mockClear();
      await store.dispatch('library/toggleTrackFavorite', 50);
      expect(app.player.isCurrentTrackLiked).toBe(true);
      if (isElectron)
        expect(send).toHaveBeenCalledWith('player', {
          playing: false,
          likedCurrentTrack: true,
        });
      const playerStorage = localStorage.getItem('player');
      await store.dispatch('session/logout');
      expect(router.push).toHaveBeenLastCalledWith({ name: 'home' });
      expect(store.getters['session/hasLibraryIdentity']).toBe(false);
      expect(credentials.get('MUSIC_U')).toBeNull();
      expect(credentials.get('__csrf')).toBeNull();
      expect(localStorage.getItem('player')).toBe(playerStorage);
      expect(localStorage.getItem('playerCurrentTrackTime')).toBe('42');
      expect(localStorage.getItem('lastfm')).toBe(
        '{"key":"independent-lastfm"}'
      );
      const restarted = createStore({ credentials });
      await restarted.dispatch('session/restore');
      expect(restarted.getters['session/hasLibraryIdentity']).toBe(false);
      expect(restarted.getters['library/user']).toEqual({});
      expect(restarted.getters['library/likedSongPlaylistID']).toBe(0);
      expect(restarted.getters['preferences/settings']).toMatchObject({
        lang: 'zh-TW',
        futureSetting: { retain: 'unknown setting' },
        dynamicSetting: { enabled: true },
      });
      expect(restarted.getters['preferences/libraryPlaylistFilter']).toBe(
        'mine'
      );
      expect(restarted.state.player._list).toEqual([50, 51]);
      expect(restarted.state.player._playNextList).toEqual([52]);
      expect(restarted.state.lastfm.key).toBe('independent-lastfm');
      expect(await getTrackDetailFromCache(['999'])).toEqual({
        songs: [track(999)],
        privileges: [{ id: 999, pl: 320000 }],
      });
      expect(JSON.parse(localStorage.getItem('data'))).toMatchObject({
        loginMode: null,
        user: {},
        likedSongPlaylistID: 0,
        futureData: { retain: 'unknown data' },
        libraryPlaylistFilter: 'mine',
      });
      expect(localStorage.getItem('data')).not.toContain('private-password');
      expect(localStorage.getItem('settings')).not.toContain(
        'private-password'
      );
    } finally {
      host?.destroy();
      jest.clearAllTimers();
      jest.useRealTimers();
      process.env = environment;
      window.require = requireDesktop;
    }
  }
);
