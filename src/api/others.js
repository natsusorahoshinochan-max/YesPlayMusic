import request from '@/utils/request';
import { getTrackDetail } from '@/api/track';

const searchCategories = {
  tracks: { type: 1, field: 'songs', count: 'songCount' },
  artists: { type: 100, field: 'artists', count: 'artistCount' },
  albums: { type: 10, field: 'albums', count: 'albumCount' },
  musicVideos: { type: 1004, field: 'mvs', count: 'mvCount' },
  playlists: { type: 1000, field: 'playlists', count: 'playlistCount' },
  users: { type: 1002, field: 'userprofiles', count: 'userprofileCount' },
};

// Translate the remote search protocol into one page of the requested category.
export async function search(
  { category, keywords, limit = 30, offset = 0 },
  { isCurrent } = {}
) {
  const { type, field, count } = searchCategories[category];
  const { result } = await request({
    url: '/search',
    isCurrent,
    method: 'get',
    params: { keywords, type, limit, offset },
  });
  const page = result[field] ?? [];
  const nextOffset = offset + page.length;
  const hasMore =
    page.length > 0 &&
    (result.hasMore ?? true) &&
    (result[count] == null || nextOffset < result[count]);
  let items = page;
  if (category === 'tracks' && page.length) {
    const details = await getTrackDetail(
      page.map(track => track.id).join(','),
      {
        isCurrent,
      }
    );
    items = details.songs;
  }
  return { items, nextOffset: hasMore ? nextOffset : null };
}

export function personalFM() {
  return request({
    url: '/personal_fm',
    method: 'get',
    params: {
      timestamp: new Date().getTime(),
    },
  });
}

export function fmTrash(id) {
  return request({
    url: '/fm_trash',
    method: 'post',
    params: {
      timestamp: new Date().getTime(),
      id,
    },
  });
}
