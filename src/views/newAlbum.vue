<template>
  <div class="newAlbum">
    <h1>{{ $t('home.newAlbum') }}</h1>
    <div class="playlist-row">
      <div class="playlists">
        <CoverRow
          type="album"
          :items="albums"
          sub-text="artist"
          :show-play-button="true"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { newAlbums } from '@/api/album';
import { createSearchProgress } from '@/utils/searchProgress';

import CoverRow from '@/components/CoverRow.vue';

export default {
  components: {
    CoverRow,
  },
  data() {
    return {
      albums: [],
    };
  },
  created() {
    this.readProgress = createSearchProgress();
    this.loadData();
  },
  beforeDestroy() {
    this.readVersion++;
    this.readProgress.dispose();
  },
  methods: {
    async loadData() {
      const version = (this.readVersion = (this.readVersion || 0) + 1);
      this.readProgress.update(true);
      try {
        const data = await newAlbums({ area: 'EA', limit: 100 });
        if (!Array.isArray(data?.albums)) throw new Error('新碟读取失败');
        if (version === this.readVersion) this.albums = data.albums;
      } catch (error) {
        if (version === this.readVersion)
          this.$store.dispatch('showToast', error.message || '新碟读取失败');
      } finally {
        if (version === this.readVersion) this.readProgress.update(false);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
h1 {
  color: var(--color-text);
  font-size: 56px;
}
</style>
