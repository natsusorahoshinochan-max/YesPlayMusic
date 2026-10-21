<template>
  <div class="track-list">
    <ContextMenu ref="menu">
      <template v-if="rightClickedItem">
        <slot name="context-menu" :item="rightClickedItem">
          <div class="item-info">
            <img
              :src="rightClickedTrack.al.picUrl | resizeImage(224)"
              loading="lazy"
            />
            <div class="info">
              <div class="title">{{ rightClickedTrack.name }}</div>
              <div class="subtitle">{{ rightClickedTrack.ar[0].name }}</div>
            </div>
          </div>
          <hr />
          <div class="item" @click="play">{{ $t('contextMenu.play') }}</div>
          <div class="item" @click="addToQueue">{{
            $t('contextMenu.addToQueue')
          }}</div>
          <hr />
          <div v-show="!isRightClickedTrackLiked" class="item" @click="like">
            {{ $t('contextMenu.saveToMyLikedSongs') }}
          </div>
          <div v-show="isRightClickedTrackLiked" class="item" @click="like">
            {{ $t('contextMenu.removeFromMyLikedSongs') }}
          </div>
          <div
            v-if="extraContextMenuItem.includes('removeTrackFromPlaylist')"
            class="item"
            @click="removeTrackFromPlaylist"
            >从歌单中删除</div
          >
          <div class="item" @click="addTrackToPlaylist">{{
            $t('contextMenu.addToPlaylist')
          }}</div>
          <div class="item" @click="copyLink">{{
            $t('contextMenu.copyUrl')
          }}</div>
        </slot>
        <slot name="context-menu-extra" :item="rightClickedItem" />
      </template>
    </ContextMenu>

    <div :style="listStyles">
      <TrackListItem
        v-for="(item, index) in items"
        :key="index"
        :track="trackOf(item)"
        :track-no="index + 1"
        :type="type"
        :album-artist="albumObject.artist.name"
        :is-liked="liked.songs.includes(trackOf(item).id)"
        :menu-open="rightClickedTrackIndex === index"
        :menu-active="rightClickedTrackIndex >= 0"
        :highlight-playing-track="highlightPlayingTrack"
        @activate="$emit('activate', item)"
        @click.right.native="openMenu($event, item, index)"
      />
    </div>
  </div>
</template>

<script>
import { mapActions, mapMutations, mapState, mapGetters } from 'vuex';

import TrackListItem from '@/components/TrackListItem.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import locale from '@/locale';
import {
  toggleTrackFavoriteWithFeedback,
  showLibraryChangeFeedback,
} from '@/utils/libraryOutcome';

export default {
  name: 'TrackList',
  components: {
    TrackListItem,
    ContextMenu,
  },
  props: {
    items: {
      type: Array,
      default: () => {
        return [];
      },
    },
    trackOf: { type: Function, default: item => item },
    type: {
      type: String,
      default: 'tracklist',
    }, // tracklist | album | playlist | cloudDisk
    playlistId: {
      type: Number,
      default: 0,
    },
    albumObject: {
      type: Object,
      default: () => {
        return {
          artist: {
            name: '',
          },
        };
      },
    },
    extraContextMenuItem: {
      type: Array,
      default: () => {
        return [
          // 'removeTrackFromPlaylist'
        ];
      },
    },
    columnNumber: {
      type: Number,
      default: 4,
    },
    highlightPlayingTrack: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      rightClickedItem: null,
      rightClickedTrackIndex: -1,
      listStyles: {},
    };
  },
  computed: {
    ...mapGetters({ liked: 'library/collections' }),
    ...mapState(['player']),
    isRightClickedTrackLiked() {
      return this.liked.songs.includes(this.rightClickedTrack?.id);
    },
    rightClickedTrack() {
      return this.trackOf(this.rightClickedItem);
    },
  },
  created() {
    if (this.type === 'tracklist') {
      this.listStyles = {
        display: 'grid',
        gap: '4px',
        gridTemplateColumns: `repeat(${this.columnNumber}, 1fr)`,
      };
    }
  },
  methods: {
    ...mapMutations(['updateModal']),
    ...mapActions(['showToast']),
    openMenu(e, item, index) {
      this.rightClickedItem = item;
      this.rightClickedTrackIndex = index;
      this.$refs.menu.openMenu(e);
    },
    closeMenu() {
      this.rightClickedItem = null;
      this.rightClickedTrackIndex = -1;
    },
    play() {
      return this.player.enqueueNext(this.rightClickedTrack.id, {
        playNow: true,
      });
    },
    addToQueue() {
      return this.player.enqueueNext(this.rightClickedTrack.id);
    },
    like() {
      return toggleTrackFavoriteWithFeedback(
        this.$store,
        this.rightClickedTrack.id
      );
    },
    addTrackToPlaylist() {
      if (!this.$store.getters['session/hasAccount']) {
        this.showToast(locale.t('toast.needToLogin'));
        return;
      }
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'show',
        value: true,
      });
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'selectedTrackID',
        value: this.rightClickedTrack.id,
      });
    },
    async removeTrackFromPlaylist() {
      if (!confirm(`确定要从歌单删除 ${this.rightClickedTrack.name}？`)) return;
      const result = await this.$store.dispatch(
        'library/removePlaylistTracks',
        {
          playlistId: this.playlistId,
          trackIds: [this.rightClickedTrack.id],
        }
      );
      showLibraryChangeFeedback(
        this.$store,
        result,
        locale.t('toast.removedFromPlaylist')
      );
    },
    copyLink() {
      this.$copyText(
        `https://music.163.com/song?id=${this.rightClickedTrack.id}`
      )
        .then(() => {
          this.showToast(locale.t('toast.copied'));
        })
        .catch(err => {
          this.showToast(`${locale.t('toast.copyFailed')}${err}`);
        });
    },
  },
};
</script>

<style lang="scss" scoped></style>
