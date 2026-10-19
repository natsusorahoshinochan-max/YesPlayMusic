export default function createState(storage) {
  return {
    showLyrics: false,
    enableScrolling: true,
    title: 'YesPlayMusic',
    contextMenu: {
      clickObjectID: 0,
      showMenu: false,
    },
    toast: {
      show: false,
      text: '',
      timer: null,
    },
    modals: {
      addTrackToPlaylistModal: {
        show: false,
        selectedTrackID: 0,
      },
      newPlaylistModal: {
        show: false,
        afterCreateAddTrackID: 0,
      },
    },
    dailyTracks: [],
    lastfm: JSON.parse(storage.getItem('lastfm')) || {},
    player: JSON.parse(storage.getItem('player')) || {},
  };
}
