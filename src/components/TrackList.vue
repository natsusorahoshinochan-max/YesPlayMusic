<template>
  <div class="track-list">
    <ContextMenu ref="menu">
      <div v-show="type !== 'cloudDisk'" class="item-info">
        <img
          :src="rightClickedTrackComputed.al.picUrl | resizeImage(224)"
          loading="lazy"
        />
        <div class="info">
          <div class="title">{{ rightClickedTrackComputed.name }}</div>
          <div class="subtitle">{{ rightClickedTrackComputed.ar[0].name }}</div>
        </div>
      </div>
      <hr v-show="type !== 'cloudDisk'" />
      <div class="item" @click="play">{{ $t('contextMenu.play') }}</div>
      <div class="item" @click="addToQueue">{{
        $t('contextMenu.addToQueue')
      }}</div>
      <div
        v-if="extraContextMenuItem.includes('removeTrackFromQueue')"
        class="item"
        @click="removeTrackFromQueue"
        >从队列删除</div
      >
      <hr v-show="type !== 'cloudDisk'" />
      <div
        v-show="!isRightClickedTrackLiked && type !== 'cloudDisk'"
        class="item"
        @click="like"
      >
        {{ $t('contextMenu.saveToMyLikedSongs') }}
      </div>
      <div
        v-show="isRightClickedTrackLiked && type !== 'cloudDisk'"
        class="item"
        @click="like"
      >
        {{ $t('contextMenu.removeFromMyLikedSongs') }}
      </div>
      <div
        v-if="extraContextMenuItem.includes('removeTrackFromPlaylist')"
        class="item"
        @click="removeTrackFromPlaylist"
        >从歌单中删除</div
      >
      <div
        v-show="type !== 'cloudDisk'"
        class="item"
        @click="addTrackToPlaylist"
        >{{ $t('contextMenu.addToPlaylist') }}</div
      >
      <div v-show="type !== 'cloudDisk'" class="item" @click="copyLink">{{
        $t('contextMenu.copyUrl')
      }}</div>
      <div
        v-if="extraContextMenuItem.includes('removeTrackFromCloudDisk')"
        class="item"
        @click="removeTrackFromCloudDisk"
        >从云盘中删除</div
      >
    </ContextMenu>

    <div :style="listStyles">
      <TrackListItem
        v-for="(track, index) in tracks"
        :key="index"
        :track-prop="track"
        :track-no="index + 1"
        :type="type"
        :album-artist="albumObject.artist.name"
        :is-liked="liked.songs.includes(track.id)"
        :menu-open="rightClickedTrackIndex === index"
        :menu-active="rightClickedTrackIndex >= 0"
        :identity="rowIdentities[index] || index"
        :row-index="index"
        :highlight-playing-track="highlightPlayingTrack"
        @activate="$emit('activate', $event)"
        @click.right.native="openMenu($event, track, index)"
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
  describeLibraryOutcome,
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
    tracks: {
      type: Array,
      default: () => {
        return [];
      },
    },
    rowIdentities: { type: Array, default: () => [] },
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
          // 'removeTrackFromQueue'
          // 'removeTrackFromCloudDisk'
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
      rightClickedTrack: {
        id: 0,
        name: '',
        ar: [{ name: '' }],
        al: { picUrl: '' },
      },
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
    rightClickedTrackComputed() {
      return this.type === 'cloudDisk'
        ? {
            id: 0,
            name: '',
            ar: [{ name: '' }],
            al: { picUrl: '' },
          }
        : this.rightClickedTrack;
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
    openMenu(e, track, index = -1) {
      this.rightClickedTrack = track;
      this.rightClickedTrackIndex = index;
      this.$refs.menu.openMenu(e);
    },
    closeMenu() {
      this.rightClickedTrack = {
        id: 0,
        name: '',
        ar: [{ name: '' }],
        al: { picUrl: '' },
      };
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
      this.showToast(
        result.outcome.status === 'succeeded'
          ? locale.t('toast.removedFromPlaylist')
          : describeLibraryOutcome(result.outcome)
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
    removeTrackFromQueue() {
      const entry = this.rowIdentities[this.rightClickedTrackIndex];
      if (entry?.group === 'next') this.player.removeNext(entry.index);
    },
    async removeTrackFromCloudDisk() {
      if (!confirm(`确定要从云盘删除 ${this.rightClickedTrack.songName}？`))
        return;
      const result = await this.$store.dispatch(
        'library/deleteCloudTrack',
        this.rightClickedTrack.songId
      );
      showLibraryChangeFeedback(this.$store, result, '已将此歌曲从云盘删除');
    },
  },
};
</script>

<style lang="scss" scoped></style>
