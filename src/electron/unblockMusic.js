const UNM = require('@unblockneteasemusic/rust-napi');
const axios = require('axios');

const executor = new UNM.Executor();

module.exports = async function unblockMusic(
  track,
  {
    unmSource,
    unmSearchMode,
    unmEnableFlac,
    unmProxyUri,
    unmJooxCookie,
    unmQQCookie,
    unmYtDlExe,
  }
) {
  const song = {
    id: String(track.id),
    name: track.name,
    duration: track.dt,
    album: { id: String(track.al.id), name: track.al.name },
    artists: track.ar.map(({ id, name }) => ({ id: String(id), name })),
  };
  const availableSources = executor.list();
  const sources =
    unmSource === ''
      ? ['ytdl', 'bilibili', 'pyncm', 'kugou']
      : unmSource
          .split(',')
          .map(source => source.trim().toLowerCase())
          .filter(source => {
            if (availableSources.includes(source)) return true;
            console.debug(`[UNM] Unsupported source: ${source}`);
            return false;
          });
  const context = {
    enableFlac: unmEnableFlac,
    searchMode:
      unmSearchMode === 'order-first'
        ? UNM.SearchMode.OrderFirst
        : UNM.SearchMode.FastFirst,
    config: {},
  };
  if (unmProxyUri) context.proxyUri = unmProxyUri;
  if (unmJooxCookie) context.config['joox:cookie'] = unmJooxCookie;
  if (unmQQCookie) context.config['qq:cookie'] = unmQQCookie;
  if (unmYtDlExe) context.config['ytdl:exe'] = unmYtDlExe;

  console.debug(`[UNM] using source: ${sources.join(', ')}`);
  try {
    const match = await executor.search(sources, song, context);
    const audio = await executor.retrieve(match, context);
    const sourceInfo = {
      from: `unm:${audio.source}`,
      bitRate: 128000,
      cached: false,
    };
    if (!audio.url.includes('bilivideo.com'))
      return { kind: 'url', url: audio.url, sourceInfo };

    const response = await axios.get(audio.url, {
      headers: {
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'okhttp/3.4.1',
      },
      responseType: 'arraybuffer',
    });
    const bytes = response.data;
    return {
      kind: 'bytes',
      bytes: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ),
      sourceInfo,
    };
  } catch (error) {
    console.debug('[UNM] Failed to find audio:', error);
    return null;
  }
};
