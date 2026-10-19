import { decode } from '@/utils/base64';

export function createAudioResources({
  cache,
  getMP3,
  hasAccount,
  isElectron = false,
  unblock,
  settings = () => ({}),
  onBackgroundError = error => console.debug('[audio resources]', error),
}) {
  const cacheInBackground = (track, url, bitRate, from) => {
    if (!settings().automaticallyCacheSongs) return;
    Promise.resolve()
      .then(() => cache.cacheTrackSource(track, url, bitRate, from))
      .catch(onBackgroundError);
  };
  const resolveFallback = async track => {
    const preferences = settings();
    if (!isElectron || preferences.enableUnblockNeteaseMusic === false)
      return null;
    const result = await unblock(
      'unblock-music',
      preferences.unmSource,
      track,
      {
        enableFlac: preferences.unmEnableFlac || null,
        proxyUri: preferences.unmProxyUri || null,
        searchMode: preferences.unmSearchMode === 'order-first' ? 1 : 0,
        config: {
          'joox:cookie': preferences.unmJooxCookie || null,
          'qq:cookie': preferences.unmQQCookie || null,
          'ytdl:exe': preferences.unmYtDlExe || null,
        },
      }
    );
    if (!result?.url) return null;
    const from = `unm:${result.source}`;
    const bytes = result.source === 'bilibili';
    cacheInBackground(
      track,
      bytes ? `data:application/octet-stream;base64,${result.url}` : result.url,
      128000,
      from
    );
    const sourceInfo = { from, bitRate: 128000, cached: false };
    return bytes
      ? { kind: 'bytes', bytes: decode(result.url), sourceInfo }
      : { kind: 'url', url: result.url, sourceInfo };
  };
  const resources = {
    async resolve(track) {
      const row = await cache.getTrackSource(Number(track.id));
      if (row)
        return {
          kind: 'bytes',
          bytes: row.source,
          sourceInfo: { from: row.from, bitRate: row.bitRate, cached: true },
        };
      if (!hasAccount())
        return {
          kind: 'url',
          url: `https://music.163.com/song/media/outer/url?id=${track.id}`,
          sourceInfo: { from: 'netease', cached: false },
        };
      const response = await getMP3(track.id);
      if (!response || !Array.isArray(response.data))
        throw new Error('Invalid NetEase audio response');
      const entry = response.data[0];
      if (!entry?.url || entry.freeTrialInfo !== null)
        return resolveFallback(track);
      const url = entry.url.replace(/^http:/, 'https:');
      cacheInBackground(track, url, entry.br, 'netease');
      return {
        kind: 'url',
        url,
        sourceInfo: { from: 'netease', bitRate: entry.br, cached: false },
      };
    },
    async prefetch(track) {
      try {
        await resources.resolve(track);
      } catch (error) {
        onBackgroundError(error);
      }
    },
  };
  return resources;
}
