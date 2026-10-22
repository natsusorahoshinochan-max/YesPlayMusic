export default function createState() {
  return {
    showLyrics: false,
    title: 'YesPlayMusic',
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
    player: null,
  };
}
