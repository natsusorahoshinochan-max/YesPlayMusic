import { likeATrack, getTrackDetail } from '@/api/track';
import { getPlaylistDetail } from '@/api/playlist';
import {
  userPlaylist,
  userPlayHistory,
  userLikedSongsIDs,
  likedAlbums,
  likedArtists,
  likedMVs,
  cloudDisk,
  userAccount,
} from '@/api/user';

export const libraryApi = {
  likeATrack,
  getTrackDetail,
  getPlaylistDetail,
  userPlaylist,
  userPlayHistory,
  userLikedSongsIDs,
  likedAlbums,
  likedArtists,
  likedMVs,
  cloudDisk,
  userAccount,
};
