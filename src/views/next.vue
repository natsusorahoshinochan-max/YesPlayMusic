<template>
  <div class="next-tracks">
    <h1>{{ $t('next.nowPlaying') }}</h1>
    <TrackList :tracks="[currentTrack]" type="playlist" />
    <h1 v-show="nextRows.length > 0"
      >插队播放
      <button @click="player.clearNext()">清除队列</button>
    </h1>
    <TrackList
      v-show="nextRows.length > 0"
      :tracks="nextRows.map(row => row.track)"
      :row-identities="nextRows"
      type="playlist"
      :highlight-playing-track="false"
      :extra-context-menu-item="['removeTrackFromQueue']"
      @activate="playQueueEntry"
    />
    <h1>{{ $t('next.nextUp') }}</h1>
    <TrackList
      :tracks="mainRows.map(row => row.track)"
      :row-identities="mainRows"
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
      tracks: [],
    };
  },
  computed: {
    ...mapState(['player']),
    currentTrack() {
      return this.player.state.currentTrack;
    },
    upcomingKey() {
      // Reading the snapshot makes queue and mode transitions reactive.
      this.player.state;
      return JSON.stringify(this.player.upcoming(100));
    },
    upcomingRows() {
      return JSON.parse(this.upcomingKey);
    },
    readyRows() {
      return this.upcomingRows
        .map(row => ({
          ...row,
          track: this.tracks.find(track => track.id === row.trackId),
        }))
        .filter(row => row.track);
    },
    nextRows() {
      return this.readyRows.filter(row => row.group === 'next');
    },
    mainRows() {
      return this.readyRows.filter(row => row.group === 'main');
    },
  },
  watch: {
    upcomingKey() {
      this.loadTracks();
    },
  },
  activated() {
    this.loadTracks();
    this.$parent.$refs.scrollbar.restorePosition();
  },
  methods: {
    playQueueEntry({ track, identity }) {
      return this.player.playQueuedTrack(track.id, identity);
    },
    async loadTracks() {
      const loaded = new Set(this.tracks.map(track => track.id));
      const ids = [
        ...new Set(this.upcomingRows.map(row => row.trackId)),
      ].filter(id => !loaded.has(id));
      if (!ids.length) return;
      try {
        const data = await getTrackDetail(ids.join(','));
        const existing = new Set(this.tracks.map(track => track.id));
        this.tracks.push(
          ...data.songs.filter(track => !existing.has(track.id))
        );
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
