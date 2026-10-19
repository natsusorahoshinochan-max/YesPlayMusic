<template>
  <div v-show="show" class="home">
    <div
      v-if="settings.showPlaylistsByAppleMusic !== false"
      class="index-row first-row"
    >
      <div class="title"> by Apple Music </div>
      <CoverRow
        :type="'playlist'"
        :items="byAppleMusic"
        sub-text="appleMusic"
        :image-size="1024"
      />
    </div>
    <div class="index-row">
      <div class="title">
        {{ $t('home.recommendPlaylist') }}
        <router-link to="/explore?category=推荐歌单">{{
          $t('home.seeMore')
        }}</router-link>
      </div>
      <CoverRow
        :type="'playlist'"
        :items="recommendPlaylist.items"
        sub-text="copywriter"
      />
    </div>
    <div class="index-row">
      <div class="title"> For You </div>
      <div class="for-you-row">
        <DailyTracksCard ref="DailyTracksCard" />
        <FMCard />
      </div>
    </div>
    <div class="index-row">
      <div class="title">{{ $t('home.recommendArtist') }}</div>
      <CoverRow
        type="artist"
        :column-number="6"
        :items="recommendArtists.items"
      />
    </div>
    <div class="index-row">
      <div class="title">
        {{ $t('home.newAlbum') }}
        <router-link to="/new-album">{{ $t('home.seeMore') }}</router-link>
      </div>
      <CoverRow
        type="album"
        :items="newReleasesAlbum.items"
        sub-text="artist"
      />
    </div>
    <div class="index-row">
      <div class="title">
        {{ $t('home.charts') }}
        <router-link to="/explore?category=排行榜">{{
          $t('home.seeMore')
        }}</router-link>
      </div>
      <CoverRow
        type="playlist"
        :items="topList.items"
        sub-text="updateFrequency"
        :image-size="1024"
      />
    </div>
  </div>
</template>

<script>
import { toplists } from '@/api/playlist';
import { toplistOfArtists } from '@/api/artist';
import { newAlbums } from '@/api/album';
import { byAppleMusic } from '@/utils/staticData';
import { getRecommendPlayList } from '@/utils/playList';
import { createSearchProgress } from '@/utils/searchProgress';
import { mapGetters } from 'vuex';
import CoverRow from '@/components/CoverRow.vue';
import FMCard from '@/components/FMCard.vue';
import DailyTracksCard from '@/components/DailyTracksCard.vue';

export default {
  name: 'Home',
  components: { CoverRow, FMCard, DailyTracksCard },
  data() {
    return {
      show: false,
      recommendPlaylist: { items: [] },
      newReleasesAlbum: { items: [] },
      topList: {
        items: [],
        ids: [19723756, 180106, 60198, 3812895, 60131],
      },
      recommendArtists: {
        items: [],
        indexs: [],
      },
    };
  },
  computed: {
    ...mapGetters({ settings: 'preferences/settings' }),

    byAppleMusic() {
      return byAppleMusic;
    },
  },
  created() {
    this.readProgress = createSearchProgress();
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
    this.loadData();
    this.$parent.$refs.scrollbar.restorePosition();
  },
  methods: {
    async loadData() {
      const version = (this.readVersion = (this.readVersion || 0) + 1);
      const current = () => version === this.readVersion;
      this.readProgress.update(true);
      const area = { all: null, zh: 1, ea: 2, jp: 4, kr: 3 };
      try {
        await Promise.all(
          [
            getRecommendPlayList(10, false).then(items => {
              if (!Array.isArray(items)) throw new Error('推荐歌单读取失败');
              if (current()) this.recommendPlaylist.items = items;
            }),
            newAlbums({
              area: this.settings.musicLanguage ?? 'ALL',
              limit: 10,
            }).then(data => {
              if (!Array.isArray(data?.albums)) throw new Error('新碟读取失败');
              if (current()) this.newReleasesAlbum.items = data.albums;
            }),
            toplistOfArtists(area[this.settings.musicLanguage ?? 'all']).then(
              data => {
                if (!Array.isArray(data?.list?.artists))
                  throw new Error('推荐艺人读取失败');
                if (!current()) return;
                const count = Math.min(6, data.list.artists.length);
                const indexes = [];
                while (indexes.length < count) {
                  const index = Math.floor(
                    Math.random() * data.list.artists.length
                  );
                  if (!indexes.includes(index)) indexes.push(index);
                }
                this.recommendArtists.indexs = indexes;
                this.recommendArtists.items = data.list.artists.filter(
                  (artist, index) => indexes.includes(index)
                );
              }
            ),
            toplists().then(data => {
              if (!Array.isArray(data?.list)) throw new Error('排行榜读取失败');
              if (current())
                this.topList.items = data.list.filter(item =>
                  this.topList.ids.includes(item.id)
                );
            }),
            this.$store.dispatch('dailyRecommendations/load'),
          ].map(job =>
            Promise.resolve(job).catch(error => {
              if (current())
                this.$store.dispatch(
                  'showToast',
                  error.message || '首页读取失败'
                );
            })
          )
        );
      } finally {
        if (current()) {
          this.show = true;
          this.readProgress.update(false);
        }
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.index-row {
  margin-top: 54px;
}
.index-row.first-row {
  margin-top: 32px;
}
.playlists {
  display: flex;
  flex-wrap: wrap;
  margin: {
    right: -12px;
    left: -12px;
  }
  .index-playlist {
    margin: 12px 12px 24px 12px;
  }
}

.title {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 20px;
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text);
  a {
    font-size: 13px;
    font-weight: 600;
    opacity: 0.68;
  }
}

footer {
  display: flex;
  justify-content: center;
  margin-top: 48px;
}

.for-you-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin-bottom: 78px;
}
</style>
