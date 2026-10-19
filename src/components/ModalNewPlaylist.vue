<template>
  <Modal
    class="add-playlist-modal"
    :show="show"
    :close="close"
    title="新建歌单"
    width="25vw"
  >
    <template slot="default">
      <input
        v-model="title"
        type="text"
        placeholder="歌单标题"
        maxlength="40"
      />
      <div class="checkbox">
        <input
          id="checkbox-private"
          v-model="privatePlaylist"
          type="checkbox"
        />
        <label for="checkbox-private">设置为隐私歌单</label>
      </div>
    </template>
    <template slot="footer">
      <button class="primary block" @click="createPlaylist">创建</button>
    </template>
  </Modal>
</template>

<script>
import Modal from '@/components/Modal.vue';
import locale from '@/locale';
import { describeLibraryOutcome } from '@/utils/libraryOutcome';
import { mapMutations, mapState, mapActions } from 'vuex';

export default {
  name: 'ModalNewPlaylist',
  components: {
    Modal,
  },
  data() {
    return {
      title: '',
      privatePlaylist: false,
    };
  },
  computed: {
    ...mapState(['modals']),
    show: {
      get() {
        return this.modals.newPlaylistModal.show;
      },
      set(value) {
        this.updateModal({
          modalName: 'newPlaylistModal',
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
  },
  methods: {
    ...mapMutations(['updateModal']),
    ...mapActions(['showToast']),
    close() {
      this.show = false;
      this.title = '';
      this.privatePlaylist = false;
      this.resetAfterCreateAddTrackID();
    },
    async createPlaylist() {
      try {
        const trackId = this.modals.newPlaylistModal.afterCreateAddTrackID;
        const result = await this.$store.dispatch('library/createPlaylist', {
          name: this.title,
          private: this.privatePlaylist,
          trackIds: trackId ? [trackId] : [],
        });
        if (result.creation.status !== 'succeeded') {
          this.showToast(describeLibraryOutcome(result.creation));
          return;
        }
        this.close();
        this.showToast('成功创建歌单');
        if (result.addition.status === 'succeeded') {
          this.showToast(locale.t('toast.savedToPlaylist'));
        } else if (result.addition.status !== 'not-requested') {
          this.showToast(describeLibraryOutcome(result.addition));
        }
        if (result.synchronization === 'incomplete') {
          this.showToast('歌单已创建，部分内容更新失败，请稍后刷新');
        }
        await this.$store
          .dispatch('preferences/setLibraryPlaylistFilter', 'mine')
          .catch(error => this.showToast(error.message || '设置保存失败'));
      } catch (error) {
        this.showToast(error.message || '创建歌单失败');
      }
    },
    resetAfterCreateAddTrackID() {
      this.updateModal({
        modalName: 'newPlaylistModal',
        key: 'afterCreateAddTrackID',
        value: 0,
      });
    },
  },
};
</script>

<style lang="scss" scoped>
.add-playlist-modal {
  .content {
    display: flex;
    flex-direction: column;
    input {
      margin-bottom: 12px;
    }
    input[type='text'] {
      width: calc(100% - 24px);
      flex: 1;
      background: var(--color-secondary-bg-for-transparent);
      font-size: 16px;
      border: none;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: 8px;
      margin-top: -1px;
      color: var(--color-text);
      &:focus {
        background: var(--color-primary-bg-for-transparent);
        opacity: 1;
      }
      [data-theme='light'] &:focus {
        color: var(--color-primary);
      }
    }
    .checkbox {
      input[type='checkbox' i] {
        margin: 3px 3px 3px 4px;
      }
      display: flex;
      align-items: center;
      label {
        font-size: 12px;
      }
      user-select: none;
    }
  }
}
</style>
