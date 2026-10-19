import { createAudioResources } from '@/playback/audioResources';

const track = { id: 42, name: 'Song', ar: [{ name: 'Artist' }] };
const setup = (overrides = {}) => {
  const cache = {
    getTrackSource: jest.fn(async () => null),
    cacheTrackSource: jest.fn(async () => {}),
  };
  const deps = {
    cache,
    getMP3: jest.fn(async () => ({
      data: [{ url: 'http://ncm/song.mp3', br: 320000, freeTrialInfo: null }],
    })),
    hasAccount: () => true,
    isElectron: true,
    settings: () => ({}),
    unblock: jest.fn(async () => null),
    onBackgroundError: jest.fn(),
    ...overrides,
  };
  return { ...deps, resources: createAudioResources(deps) };
};

test('cached bytes retain source provenance and avoid remote requests', async () => {
  const deps = setup();
  deps.cache.getTrackSource.mockResolvedValue({
    source: new Uint8Array([1, 2]).buffer,
    from: 'unm:kuwo',
    bitRate: 128000,
  });
  expect(await deps.resources.resolve(track)).toEqual({
    kind: 'bytes',
    bytes: new Uint8Array([1, 2]).buffer,
    sourceInfo: { from: 'unm:kuwo', bitRate: 128000, cached: true },
  });
  expect(deps.cache.getTrackSource).toHaveBeenCalledWith(42);
  expect(deps.getMP3).not.toHaveBeenCalled();
});

test('account resolution upgrades NetEase URL and starts optional background cache', async () => {
  const deps = setup({ settings: () => ({ automaticallyCacheSongs: true }) });
  expect(await deps.resources.resolve(track)).toEqual({
    kind: 'url',
    url: 'https://ncm/song.mp3',
    sourceInfo: { from: 'netease', bitRate: 320000, cached: false },
  });
  expect(deps.cache.cacheTrackSource).toHaveBeenCalledWith(
    track,
    'https://ncm/song.mp3',
    320000,
    'netease'
  );
  expect(deps.unblock).not.toHaveBeenCalled();
});

test('unavailable NetEase falls back to configured Electron provider bytes', async () => {
  const deps = setup({
    getMP3: async () => ({
      data: [{ url: 'http://trial', freeTrialInfo: {} }],
    }),
    settings: () => ({
      automaticallyCacheSongs: true,
      unmSource: ['bilibili'],
      unmSearchMode: 'order-first',
      unmEnableFlac: true,
      unmProxyUri: 'proxy',
      unmQQCookie: 'cookie',
    }),
    unblock: jest.fn(async () => ({ source: 'bilibili', url: 'AQI=' })),
  });
  expect(await deps.resources.resolve(track)).toEqual({
    kind: 'bytes',
    bytes: new Uint8Array([1, 2]).buffer,
    sourceInfo: { from: 'unm:bilibili', bitRate: 128000, cached: false },
  });
  expect(deps.unblock).toHaveBeenCalledWith(
    'unblock-music',
    ['bilibili'],
    track,
    {
      enableFlac: true,
      proxyUri: 'proxy',
      searchMode: 1,
      config: { 'joox:cookie': null, 'qq:cookie': 'cookie', 'ytdl:exe': null },
    }
  );
  expect(deps.cache.cacheTrackSource).toHaveBeenCalledWith(
    track,
    'data:application/octet-stream;base64,AQI=',
    128000,
    'unm:bilibili'
  );
});

test.each([false, true])(
  'visitor/public-library identity uses outer URL without account request (%s)',
  async isElectron => {
    const deps = setup({ hasAccount: () => false, isElectron });
    expect((await deps.resources.resolve(track)).url).toBe(
      'https://music.163.com/song/media/outer/url?id=42'
    );
    expect(deps.getMP3).not.toHaveBeenCalled();
    expect(deps.unblock).not.toHaveBeenCalled();
  }
);

test.each([
  { isElectron: false },
  { settings: () => ({ enableUnblockNeteaseMusic: false }) },
])(
  'unavailable source remains null when Electron fallback is disabled',
  async options => {
    const deps = setup({ getMP3: async () => ({ data: [] }), ...options });
    expect(await deps.resources.resolve(track)).toBeNull();
    expect(deps.unblock).not.toHaveBeenCalled();
  }
);

test('request rejection remains rejected and never tries another source', async () => {
  const error = new Error('network');
  const deps = setup({
    getMP3: async () => {
      throw error;
    },
  });
  await expect(deps.resources.resolve(track)).rejects.toBe(error);
  expect(deps.unblock).not.toHaveBeenCalled();
});

test('prefetch contains failures and background cache failure does not invalidate resolved audio', async () => {
  const deps = setup({ settings: () => ({ automaticallyCacheSongs: true }) });
  const failure = new Error('disk full');
  deps.cache.cacheTrackSource.mockRejectedValue(failure);
  expect((await deps.resources.resolve(track)).url).toBe(
    'https://ncm/song.mp3'
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(deps.onBackgroundError).toHaveBeenCalledWith(failure);
  const networkError = new Error('offline');
  deps.getMP3.mockRejectedValue(networkError);
  await expect(deps.resources.prefetch(track)).resolves.toBeUndefined();
  expect(deps.onBackgroundError).toHaveBeenCalledWith(networkError);
});
