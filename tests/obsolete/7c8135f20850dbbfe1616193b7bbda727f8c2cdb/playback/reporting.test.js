import { createPlayer } from '@/application/player';
import request from '@/utils/request';
import axios from 'axios';

jest.mock('@/utils/request', () => jest.fn());
jest.mock('axios', () => jest.fn());
jest.mock('@/utils/db', () => ({
  getTrackDetailFromCache: jest.fn(async () => null),
  cacheTrackDetail: jest.fn(async () => {}),
  getTrackSource: jest.fn(async () => null),
  cacheTrackSource: jest.fn(async () => {}),
}));

function setup({ key, duration = 200900, onPlaybackEvent } = {}) {
  const handles = [];
  const store = {
    state: { lastfm: { key } },
    getters: { 'preferences/settings': {}, 'session/hasAccount': false },
    dispatch: jest.fn(),
  };
  localStorage.setItem('lastfm', JSON.stringify({ key }));
  request.mockImplementation(async config => {
    if (config.url === '/song/detail') {
      return {
        songs: [
          {
            id: Number(config.params.ids),
            name: 'Song',
            dt: duration,
            ar: [{ name: 'First' }, { name: 'Second' }],
            al: { name: 'Album' },
            no: 3,
          },
        ],
        privileges: [{ id: Number(config.params.ids), pl: 320000 }],
      };
    }
    if (config.url === '/personal_fm')
      return { data: [{ id: 80 }, { id: 81 }] };
    return { code: 200 };
  });
  axios.mockResolvedValue({ data: {} });
  const audio = {
    prepare: jest.fn(async (resource, events) => {
      let position = 0;
      const handle = {
        play: () => events.onPlay(),
        pause: () => events.onPause(),
        seek: value => {
          position = value;
        },
        position: () => position,
        setVolume() {},
        applyOutputDevice() {},
        dispose() {},
        events,
      };
      handles.push(handle);
      return handle;
    }),
  };
  const player = createPlayer({
    store,
    audio,
    ...(onPlaybackEvent ? { onPlaybackEvent } : {}),
    setInterval: () => 1,
    clearInterval() {},
  });
  return {
    player,
    handles,
    store,
    select: (id, source = 10) =>
      player.playTracks([id], { source: { id: source, type: 'playlist' } }),
    records: () =>
      request.mock.calls
        .map(([config]) => config)
        .filter(config => config.url === '/scrobble'),
    lastfm: method =>
      axios.mock.calls
        .map(([config]) => config)
        .filter(config => config.params.method === method),
  };
}

test('replacement reports the old song, source and floored position through the real NetEase API', async () => {
  const { player, select, records } = setup();
  expect(await select(1, 10)).toEqual({ status: 'completed' });
  player.seek(12.9);
  expect(await select(2, 20)).toEqual({ status: 'completed' });
  expect(records()).toEqual([
    {
      url: '/scrobble',
      method: 'get',
      params: { id: 1, sourceid: 10, time: 12, timestamp: expect.any(Number) },
    },
  ]);
  player.dispose();
});

test('Last.fm reports a half-track listen with first artist, full duration and derived start time', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const { player, select, lastfm } = setup({ key: 'authorized' });
  await select(1);
  player.seek(100.9);
  await select(2);
  expect(lastfm('track.scrobble')).toHaveLength(1);
  expect(lastfm('track.scrobble')[0]).toMatchObject({
    url: 'https://ws.audioscrobbler.com/2.0/',
    method: 'POST',
    params: {
      artist: 'First',
      track: 'Song',
      album: 'Album',
      trackNumber: 3,
      duration: 200,
      timestamp: 900,
      sk: 'authorized',
      format: 'json',
      api_sig: expect.any(String),
    },
  });
  player.dispose();
});

test('actual play and resume update Now Playing while repeated play and old callbacks stay silent', async () => {
  const { player, select, handles, lastfm } = setup({ key: 'authorized' });
  await select(1);
  expect(lastfm('track.updateNowPlaying')).toHaveLength(1);
  expect(lastfm('track.updateNowPlaying')[0].params).toMatchObject({
    artist: 'First',
    track: 'Song',
    album: 'Album',
    trackNumber: 3,
    duration: 200,
    sk: 'authorized',
    api_sig: expect.any(String),
  });
  expect(lastfm('track.updateNowPlaying')[0].params).not.toHaveProperty(
    'timestamp'
  );
  player.play();
  expect(lastfm('track.updateNowPlaying')).toHaveLength(1);
  player.pause();
  player.play();
  expect(lastfm('track.updateNowPlaying')).toHaveLength(2);
  await select(2);
  handles[0].events.onPlay();
  handles[0].events.onEnd();
  expect(lastfm('track.updateNowPlaying')).toHaveLength(3);
  expect(lastfm('track.scrobble')).toHaveLength(0);
  player.dispose();
});

test('natural end uses full seconds and claims once before unsettled requests and later replacement', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const { player, select, handles, records, lastfm } = setup({
    key: 'authorized',
  });
  await select(1, 17);
  request.mockImplementation(config =>
    config.url === '/scrobble'
      ? new Promise(() => {})
      : Promise.resolve({
          songs: [
            {
              id: 2,
              name: 'Next',
              dt: 200900,
              ar: [{ name: 'Next artist' }],
              al: { name: 'Next album' },
            },
          ],
          privileges: [{ id: 2, pl: 320000 }],
        })
  );
  player.seek(9.7);
  handles[0].events.onEnd();
  await select(2, 22);
  expect(records()).toHaveLength(1);
  expect(records()[0].params).toMatchObject({ id: 1, sourceid: 17, time: 200 });
  expect(lastfm('track.scrobble')).toHaveLength(1);
  expect(lastfm('track.scrobble')[0].params).toMatchObject({
    duration: 200,
    timestamp: 800,
  });
  handles[0].events.onEnd();
  expect(records()).toHaveLength(1);
  player.dispose();
});

test.each([
  ['below half', 200900, 99.99, 'authorized', 0],
  ['half', 200900, 100, 'authorized', 1],
  ['below 240', 600900, 239.99, 'authorized', 0],
  ['240', 600900, 240, 'authorized', 1],
  ['missing authorization', 200900, 150, undefined, 0],
  ['null key exists', 200900, 100, null, 1],
])(
  '%s retains NetEase reporting and applies the Last.fm threshold and key condition',
  async (label, duration, position, key, count) => {
    const { player, select, records, lastfm } = setup({ key, duration });
    await select(1);
    player.seek(position);
    await select(2);
    expect(records()).toHaveLength(1);
    expect(lastfm('track.scrobble')).toHaveLength(count);
    expect(lastfm('track.updateNowPlaying')).toHaveLength(
      key === undefined ? 0 : 2
    );
    player.dispose();
  }
);

test('a replacement below one second sends no listening record; a new eligible instance records', async () => {
  const { player, select, records, lastfm } = setup({ key: 'authorized' });
  await select(1);
  player.seek(0.99);
  await select(2);
  expect(records()).toHaveLength(0);
  expect(lastfm('track.scrobble')).toHaveLength(0);
  player.seek(1);
  await select(3);
  expect(records()).toHaveLength(1);
  expect(records()[0].params).toMatchObject({ id: 2, time: 1 });
  player.dispose();
});

test('rejected reporting requests are logged and do not block later playback or retry a claimed instance', async () => {
  const log = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const failure = new Error('reporting offline');
  const { player, select, handles, records } = setup();
  await select(1);
  request.mockRejectedValueOnce(failure);
  handles[0].events.onEnd();
  expect(await select(2)).toEqual({ status: 'completed' });
  expect(records()).toHaveLength(1);
  expect(log).toHaveBeenCalledWith(
    '[playback reporting] request failed',
    failure
  );
  player.dispose();
});

test('application observers receive events while the production reporting receiver still records', async () => {
  const observer = jest.fn();
  const { player, select, records } = setup({ onPlaybackEvent: observer });
  await select(1);
  player.seek(3);
  await select(2);
  expect(records()).toHaveLength(1);
  expect(observer.mock.calls.map(([event]) => event.type)).toEqual([
    'played',
    'before-replace',
    'played',
  ]);
  player.dispose();
});

test('single repeat creates distinct reporting instances and retains the original source across natural end and replacement', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const events = [];
  let repeated;
  const repeatedPlay = new Promise(resolve => {
    repeated = resolve;
  });
  const { player, select, handles, records, lastfm } = setup({
    key: 'authorized',
    onPlaybackEvent: event => {
      events.push(event);
      if (
        event.type === 'played' &&
        events.filter(item => item.type === 'played').length === 2
      )
        repeated();
    },
  });
  try {
    await select(1, 17);
    player.cycleRepeat();
    player.cycleRepeat();
    handles[0].events.onEnd();
    await repeatedPlay;
    expect(player.state).toMatchObject({
      currentTrackID: 1,
      repeatMode: 'one',
      playing: true,
    });
    const played = events.filter(event => event.type === 'played');
    expect(played[0].operationId).toBe(played[1].operationId);
    expect(played[0].instanceId).not.toBe(played[1].instanceId);
    expect(records().map(record => record.params)).toEqual([
      { id: 1, sourceid: 17, time: 200, timestamp: expect.any(Number) },
    ]);
    player.seek(100.9);
    await select(2, 22);
    expect(records().map(record => record.params)).toEqual([
      { id: 1, sourceid: 17, time: 200, timestamp: expect.any(Number) },
      { id: 1, sourceid: 17, time: 100, timestamp: expect.any(Number) },
    ]);
    expect(
      lastfm('track.scrobble').map(record => record.params.timestamp)
    ).toEqual([800, 900]);
    expect(lastfm('track.updateNowPlaying')).toHaveLength(3);
    handles[0].events.onEnd();
    handles[1].events.onEnd();
    expect(records()).toHaveLength(2);
    expect(
      events
        .filter(event => event.type === 'before-replace')
        .map(event => event.instanceId)
    ).toEqual(played.map(event => event.instanceId));
  } finally {
    player.dispose();
  }
});

test('personal FM natural end and later ordinary selection report only their owning instances and source', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const events = [];
  let advanced;
  const nextPlay = new Promise(resolve => {
    advanced = resolve;
  });
  const { player, select, handles, records, lastfm } = setup({
    key: 'authorized',
    onPlaybackEvent: event => {
      events.push(event);
      if (event.type === 'played' && event.track.id === 81) advanced();
    },
  });
  try {
    await select(1, 17);
    player.seek(5.9);
    await player.playPersonalFM();
    expect(player.state).toMatchObject({
      currentTrackID: 80,
      isPersonalFM: true,
    });
    handles[1].events.onEnd();
    await nextPlay;
    player.seek(101.9);
    await select(2, 22);
    expect(records().map(record => record.params)).toEqual([
      { id: 1, sourceid: 17, time: 5, timestamp: expect.any(Number) },
      { id: 80, sourceid: 0, time: 200, timestamp: expect.any(Number) },
      { id: 81, sourceid: 0, time: 101, timestamp: expect.any(Number) },
    ]);
    const played = events.filter(event => event.type === 'played');
    expect(played.map(event => event.track.id)).toEqual([1, 80, 81, 2]);
    expect(new Set(played.map(event => event.instanceId)).size).toBe(4);
    expect(played[1].operationId).toBe(played[2].operationId);
    expect(played[2].operationId).not.toBe(played[3].operationId);
    expect(
      lastfm('track.scrobble').map(record => record.params.timestamp)
    ).toEqual([800, 899]);
    expect(lastfm('track.updateNowPlaying')).toHaveLength(4);
    handles.slice(0, 3).forEach(handle => {
      handle.events.onEnd();
      handle.events.onPlay();
    });
    expect(records()).toHaveLength(3);
    expect(lastfm('track.updateNowPlaying')).toHaveLength(4);
  } finally {
    player.dispose();
  }
});
