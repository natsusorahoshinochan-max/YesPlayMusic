export function createAudioResources({
  cache,
  getMP3,
  hasAccount,
  isElectron = false,
  unblock,
  settings = () => ({}),
  onBackgroundError = error => console.debug('[audio resources]', error),
}) {
  const cacheInBackground = (track, resource) => {
    if (!settings().automaticallyCacheSongs) return;
    Promise.resolve()
      .then(() => cache.cacheTrackSource(track, resource))
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
    if (result === null) return null;
    cacheInBackground(track, result);
    return result;
  };
  const resources = {
    async resolve(track) {
      const row = await cache.getTrackSource(track.id);
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
      const response = await getMP3(track.id, {
        quality: settings().musicQuality,
      });
      const entry = response.data[0];
      if (!entry?.url || entry.freeTrialInfo !== null)
        return resolveFallback(track);
      const url = entry.url.replace(/^http:/, 'https:');
      const resource = {
        kind: 'url',
        url,
        sourceInfo: { from: 'netease', bitRate: entry.br, cached: false },
      };
      cacheInBackground(track, resource);
      return resource;
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
