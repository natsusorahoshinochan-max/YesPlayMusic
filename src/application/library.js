import { likeATrack, getTrackDetail } from '@/api/track';
import {
  getPlaylistDetail,
  subscribePlaylist,
  createPlaylist,
  deletePlaylist,
  addOrRemoveTrackFromPlaylist,
} from '@/api/playlist';
import { likeAAlbum } from '@/api/album';
import { followAArtist } from '@/api/artist';
import { likeAMV } from '@/api/mv';
import {
  userPlaylist,
  userPlayHistory,
  userLikedSongsIDs,
  likedAlbums,
  likedArtists,
  likedMVs,
  cloudDisk,
  userAccount,
  uploadSong,
  cloudDiskTrackDelete,
} from '@/api/user';

export const libraryApi = {
  subscribePlaylist,
  createPlaylist,
  deletePlaylist,
  addOrRemoveTrackFromPlaylist,
  likeAAlbum,
  followAArtist,
  likeAMV,
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
  uploadSong,
  cloudDiskTrackDelete,
};
