<template>
  <Modal
    class="add-track-to-playlist-modal"
    :show="show"
    :close="close"
    :show-footer="false"
    title="添加到歌单"
    width="25vw"
  >
    <template slot="default">
      <div class="new-playlist-button" @click="newPlaylist"
        ><svg-icon icon-class="plus" />新建歌单</div
      >
      <div
        v-for="playlist in ownPlaylists"
        :key="playlist.id"
        class="playlist"
        @click="addTrackToPlaylist(playlist.id)"
      >
        <img :src="playlist.coverImgUrl | resizeImage(224)" loading="lazy" />
        <div class="info">
          <div class="title">{{ playlist.name }}</div>
          <div class="track-count">{{ playlist.trackCount }} 首</div>
        </div>
      </div>
    </template>
  </Modal>
</template>

<script>
import { mapActions, mapMutations, mapState, mapGetters } from 'vuex';
import Modal from '@/components/Modal.vue';
import locale from '@/locale';
import { describeLibraryOutcome } from '@/utils/libraryOutcome';

export default {
  name: 'ModalAddTrackToPlaylist',
  components: {
    Modal,
  },
  computed: {
    ...mapGetters({
      user: 'library/user',
      likedSongPlaylistID: 'library/likedSongPlaylistID',
      liked: 'library/collections',
    }),
    ...mapState(['modals']),
    show: {
      get() {
        return this.modals.addTrackToPlaylistModal.show;
      },
      set(value) {
        this.updateModal({
          modalName: 'addTrackToPlaylistModal',
          key: 'show',
          value,
        });
        if (value) {
          this.$store.commit('enableScrolling', false);
        } else {
          this.$store.commit('enableScrolling', true);
        }
      },
    },
    ownPlaylists() {
      return this.liked.playlists.filter(
        p =>
          p.creator.userId === this.user.userId &&
          p.id !== this.likedSongPlaylistID
      );
    },
  },
  methods: {
    ...mapMutations(['updateModal']),
    ...mapActions(['showToast']),
    close() {
      this.show = false;
    },
    async addTrackToPlaylist(playlistId) {
      try {
        const result = await this.$store.dispatch('library/addPlaylistTracks', {
          playlistId,
          trackIds: [this.modals.addTrackToPlaylistModal.selectedTrackID],
        });
        if (result.outcome.status !== 'succeeded') {
          this.showToast(describeLibraryOutcome(result.outcome));
          return;
        }
        this.close();
        this.showToast(locale.t('toast.savedToPlaylist'));
        if (result.synchronization === 'incomplete') {
          this.showToast('歌曲已添加，部分内容更新失败，请稍后刷新');
        }
      } catch (error) {
        this.showToast(error.message || '添加歌曲失败');
      }
    },
    newPlaylist() {
      this.updateModal({
        modalName: 'newPlaylistModal',
        key: 'afterCreateAddTrackID',
        value: this.modals.addTrackToPlaylistModal.selectedTrackID,
      });
      this.close();
      this.updateModal({
        modalName: 'newPlaylistModal',
        key: 'show',
        value: true,
      });
    },
  },
};
</script>

<style lang="scss" scoped>
.new-playlist-button {
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text);
  background: var(--color-secondary-bg-for-transparent);
  border-radius: 8px;
  height: 48px;
  margin-bottom: 16px;
  margin-right: 6px;
  margin-left: 6px;
  cursor: pointer;
  transition: 0.2s;
  .svg-icon {
    width: 16px;
    height: 16px;
    margin-right: 8px;
  }
  &:hover {
    color: var(--color-primary);
    background: var(--color-primary-bg-for-transparent);
  }
}
.playlist {
  display: flex;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
  &:hover {
    background: var(--color-secondary-bg-for-transparent);
  }
  img {
    border-radius: 8px;
    height: 42px;
    width: 42px;
    margin-right: 12px;
    border: 1px solid rgba(0, 0, 0, 0.04);
  }
  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .title {
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text);
    padding-right: 16px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
    word-break: break-all;
  }
  .track-count {
    margin-top: 2px;
    font-size: 13px;
    opacity: 0.68;
    color: var(--color-text);
  }
}
</style>
