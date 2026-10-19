<template>
  <div v-show="show">
    <h1>
      <img
        class="avatar"
        :src="artist.img1v1Url | resizeImage(1024)"
        loading="lazy"
      />{{ artist.name }}'s Music Videos
    </h1>
    <MvRow :mvs="mvs" subtitle="publishTime" />
    <div class="load-more">
      <ButtonTwoTone v-show="hasMore" color="grey" @click.native="loadMVs()">{{
        $t('explore.loadMore')
      }}</ButtonTwoTone>
    </div>
  </div>
</template>

<script>
import { artistMv, getArtist } from '@/api/artist';
import { createSearchProgress } from '@/utils/searchProgress';

import ButtonTwoTone from '@/components/ButtonTwoTone.vue';
import MvRow from '@/components/MvRow.vue';

export default {
  name: 'ArtistMV',
  components: {
    MvRow,
    ButtonTwoTone,
  },
  beforeRouteUpdate(to, from, next) {
    this.id = to.params.id;
    this.loadData();
    next();
  },
  data() {
    return {
      id: 0,
      show: false,
      hasMore: true,
      artist: {},
      mvs: [],
    };
  },
  created() {
    this.readProgress = createSearchProgress();
    this.id = this.$route.params.id;
    this.loadData();
  },
  beforeDestroy() {
    this.readVersion++;
    this.readProgress.dispose();
  },
  deactivated() {
    this.readVersion++;
    this.readProgress.dispose();
  },
  activated() {
    if (this.$route.params.id !== this.id) {
      this.id = this.$route.params.id;
      this.mvs = [];
      this.artist = {};
      this.show = false;
      this.hasMore = true;
      this.loadData();
    }
  },
  methods: {
    async loadData() {
      const version = (this.readVersion = (this.readVersion || 0) + 1);
      this.readProgress.update(true);
      try {
        await Promise.all([
          getArtist(this.id)
            .then(data => {
              if (!data?.artist) throw new Error('艺人读取失败');
              if (version === this.readVersion) this.artist = data.artist;
            })
            .catch(error => {
              if (version === this.readVersion)
                this.$store.dispatch(
                  'showToast',
                  error.message || '艺人读取失败'
                );
            }),
          this.loadMVs(version),
        ]);
      } finally {
        if (version === this.readVersion) this.readProgress.update(false);
      }
    },
    async loadMVs(parentVersion) {
      const version =
        parentVersion ?? (this.readVersion = (this.readVersion || 0) + 1);
      if (parentVersion == null) this.readProgress.update(true);
      try {
        const data = await artistMv({
          id: this.id,
          limit: 100,
          offset: this.mvs.length,
        });
        if (!Array.isArray(data?.mvs)) throw new Error('艺人 MV 读取失败');
        if (version !== this.readVersion) return;
        this.mvs.push(...data.mvs);
        this.hasMore = data.hasMore;
        this.show = true;
      } catch (error) {
        if (version === this.readVersion)
          this.$store.dispatch(
            'showToast',
            error.message || '艺人 MV 读取失败'
          );
      } finally {
        if (parentVersion == null && version === this.readVersion)
          this.readProgress.update(false);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
h1 {
  font-size: 42px;
  color: var(--color-text);
  .avatar {
    height: 44px;
    margin-right: 12px;
    vertical-align: -7px;
    border-radius: 50%;
    border: rgba(0, 0, 0, 0.2);
  }
}
.load-more {
  display: flex;
  justify-content: center;
}
</style>
