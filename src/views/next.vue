<template>
  <div class="next-tracks">
    <template v-if="currentTrack.id">
      <h1>{{ $t('next.nowPlaying') }}</h1>
      <TrackList :items="[currentTrack]" type="playlist" />
    </template>
    <h1 v-show="nextRows.length > 0"
      >插队播放
      <button @click="player.clearNext()">清除队列</button>
    </h1>
    <TrackList
      v-show="nextRows.length > 0"
      :items="nextRows"
      :track-of="row => row.track"
      type="playlist"
      :highlight-playing-track="false"
      @activate="playQueueEntry"
    >
      <template #context-menu-extra="{ item }">
        <div class="item" @click="player.removeNext(item.index)"
          >从队列删除</div
        >
      </template>
    </TrackList>
    <h1>{{ $t('next.nextUp') }}</h1>
    <TrackList
      :items="mainRows"
      :track-of="row => row.track"
      type="playlist"
      :highlight-playing-track="false"
      @activate="playQueueEntry"
    />
  </div>
</template>

<script>
import { mapState } from 'vuex';
import { getTrackDetail } from '@/api/track';
import TrackList from '@/components/TrackList.vue';

export default {
  name: 'Next',
  components: {
    TrackList,
  },
  data() {
    return {
      entries: [],
      tracksRequest: 0,
    };
  },
  computed: {
    ...mapState(['player']),
    currentTrack() {
      return this.player.state.currentTrack;
    },
    upcomingRows() {
      return this.player.upcoming(100);
    },
    nextRows() {
      return this.entries.filter(row => row.group === 'next');
    },
    mainRows() {
      return this.entries.filter(row => row.group === 'main');
    },
  },
  watch: {
    upcomingRows: {
      immediate: true,
      handler: 'loadTracks',
    },
  },
  activated() {
    this.$parent.$refs.scrollbar.restorePosition();
  },
  methods: {
    playQueueEntry(entry) {
      return this.player.playQueuedTrack(entry.trackId, entry);
    },
    async loadTracks(rows) {
      const request = ++this.tracksRequest;
      const ids = rows.map(row => row.trackId);
      this.entries = [];
      if (!ids.length) return;
      try {
        const data = await getTrackDetail(ids);
        if (request !== this.tracksRequest) return;
        this.entries = rows
          .map(row => ({
            ...row,
            track: data.songs.find(track => track.id === row.trackId),
          }))
          .filter(row => row.track);
      } catch (error) {
        console.debug('[upcoming metadata]', error);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
h1 {
  margin-top: 36px;
  margin-bottom: 18px;
  cursor: default;
  color: var(--color-text);
  display: flex;
  justify-content: space-between;
  button {
    color: var(--color-text);
    border-radius: 8px;
    padding: 0 14px;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: 0.2s;
    opacity: 0.68;
    font-weight: 500;
    &:hover {
      opacity: 1;
      background: var(--color-secondary-bg);
    }
    &:active {
      opacity: 1;
      transform: scale(0.92);
    }
  }
}
</style>
