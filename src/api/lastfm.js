// Last.fm API documents 👉 https://www.last.fm/api

import axios from 'axios';
import md5 from 'crypto-js/md5';

const apiKey = process.env.VUE_APP_LASTFM_API_KEY;
const apiSharedSecret = process.env.VUE_APP_LASTFM_API_SHARED_SECRET;
const baseUrl = window.location.origin;
const url = 'https://ws.audioscrobbler.com/2.0/';

const sign = params => {
  const signature = Object.keys(params)
    .sort()
    .map(key => `${key}${params[key]}`)
    .join('');
  return md5(signature + apiSharedSecret).toString();
};

export function auth() {
  const url = process.env.IS_ELECTRON
    ? `https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${baseUrl}/#/lastfm/callback`
    : `https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${baseUrl}/lastfm/callback`;
  window.open(url);
}

export function authGetSession(token) {
  const params = { api_key: apiKey, method: 'auth.getSession', token };
  return axios({
    url,
    method: 'GET',
    params: {
      ...params,
      api_sig: sign(params),
      format: 'json',
    },
  });
}

function send(method, params, authorization) {
  params = {
    ...params,
    api_key: apiKey,
    method,
    sk: authorization.key,
  };
  return axios({
    url,
    method: 'POST',
    params: {
      ...params,
      api_sig: sign(params),
      format: 'json',
    },
  });
}

export function trackUpdateNowPlaying(params, authorization) {
  return send('track.updateNowPlaying', params, authorization);
}

export function trackScrobble(params, authorization) {
  return send('track.scrobble', params, authorization);
}
