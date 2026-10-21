<template>
  <div v-show="show" class="search">
    <h1>
      <span>{{ $t('search.searchFor') }} {{ typeNameTable[type] }}</span> "{{
        keywords
      }}"
    </h1>

    <div v-if="type === 'artists'">
      <CoverRow type="artist" :items="result" :column-number="6" />
    </div>
    <div v-if="type === 'albums'">
      <CoverRow
        type="album"
        :items="result"
        sub-text="artist"
        sub-text-font-size="14px"
      />
    </div>
    <div v-if="type === 'tracks'">
      <TrackList :items="result" type="playlist" @activate="playSearchTrack" />
    </div>
    <div v-if="type === 'musicVideos'">
      <MvRow :mvs="result" />
    </div>
    <div v-if="type === 'playlists'">
      <CoverRow type="playlist" :items="result" sub-text="title" />
    </div>

    <div class="load-more">
      <ButtonTwoTone v-show="hasMore" color="grey" @click.native="fetchData">{{
        $t('explore.loadMore')
      }}</ButtonTwoTone>
    </div>
  </div>
</template>

<script>
import { createMusicSearch } from '@/application/musicSearch';
import locale from '@/locale';
import { camelCase } from 'change-case';
import { createSearchProgress } from '@/utils/searchProgress';
import TrackList from '@/components/TrackList.vue';
import MvRow from '@/components/MvRow.vue';
import CoverRow from '@/components/CoverRow.vue';
import ButtonTwoTone from '@/components/ButtonTwoTone.vue';

export default {
  name: 'SearchType',
  components: { TrackList, MvRow, CoverRow, ButtonTwoTone },
  data() {
    return {
      query: createMusicSearch(this.$store),
      progress: createSearchProgress(),
    };
  },
  computed: {
    keywords() {
      return this.$route.params.keywords ?? '';
    },
    type() {
      return camelCase(this.$route.params.type);
    },
    queryIntent() {
      return { keywords: this.keywords, category: this.type };
    },
    show() {
      return this.query.state.loaded;
    },
    result() {
      return this.query.state.results[this.type] ?? [];
    },
    hasMore() {
      return this.query.state.hasMore && !this.query.state.loading;
    },
    typeNameTable() {
      return {
        musicVideos: locale.t('search.mv'),
        tracks: locale.t('search.song'),
        albums: locale.t('search.album'),
        artists: locale.t('search.artist'),
        playlists: locale.t('search.playlist'),
      };
    },
  },
  watch: {
    queryIntent() {
      this.query.replace(this.queryIntent);
    },
    'query.state.loading'(loading) {
      this.progress.update(loading);
    },
  },
  created() {
    this.query.replace(this.queryIntent);
  },
  beforeDestroy() {
    this.query.dispose();
    this.progress.dispose();
  },
  methods: {
    playSearchTrack(track) {
      return this.$store.state.player.playTracks(
        this.result.map(t => t.id),
        {
          source: { type: 'url', id: `/search/${this.keywords}/tracks` },
          startTrackId: track.id,
        }
      );
    },
    fetchData() {
      return this.query.loadNext();
    },
  },
};
</script>

<style lang="scss" scoped>
h1 {
  margin-top: 32px;
  margin-bottom: 28px;
  color: var(--color-text);
  span {
    opacity: 0.58;
  }
}
.load-more {
  display: flex;
  justify-content: center;
  margin-top: 32px;
}

.button.more {
  .svg-icon {
    height: 24px;
    width: 24px;
  }
}
</style>
