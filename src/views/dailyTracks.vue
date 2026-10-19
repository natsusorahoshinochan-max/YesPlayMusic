<template>
  <div>
    <div v-if="status === 'error'" class="load-error">
      每日推荐加载失败
      <button class="retry" @click="loadDailyTracks">重试</button>
    </div>
    <div v-show="show">
      <div class="special-playlist">
        <div class="title gradient"> 每日歌曲推荐 </div>
        <div class="subtitle">根据你的音乐口味生成 · 每天6:00更新</div>
        <div class="buttons">
          <ButtonTwoTone
            class="play-button"
            icon-class="play"
            color="grey"
            @click.native="playDailyTracks()"
          >
            {{ $t('common.play') }}
          </ButtonTwoTone>
        </div>
      </div>

      <TrackList
        :tracks="dailyTracks"
        type="playlist"
        @activate="playDailyTracks($event.track.id)"
      />
    </div>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';

import ButtonTwoTone from '@/components/ButtonTwoTone.vue';
import TrackList from '@/components/TrackList.vue';

export default {
  name: 'DailyTracks',
  components: {
    ButtonTwoTone,
    TrackList,
  },
  computed: {
    ...mapState('dailyRecommendations', {
      dailyTracks: 'tracks',
      status: 'status',
    }),
    show() {
      return this.status === 'loaded';
    },
  },
  created() {
    this.loadDailyTracks();
    this.$parent.$refs.main.scrollTo(0, 0);
  },
  methods: {
    ...mapActions('dailyRecommendations', {
      loadDailyTracks: 'load',
      playDailyTracks: 'play',
    }),
  },
};
</script>

<style lang="scss" scoped>
.special-playlist {
  margin-top: 192px;
  margin-bottom: 128px;
  border-radius: 1.25em;
  text-align: center;

  @keyframes letterSpacing4 {
    from {
      letter-spacing: 0px;
    }

    to {
      letter-spacing: 4px;
    }
  }

  @keyframes letterSpacing1 {
    from {
      letter-spacing: 0px;
    }

    to {
      letter-spacing: 1px;
    }
  }

  .title {
    font-size: 84px;
    line-height: 1.05;
    font-weight: 700;
    text-transform: uppercase;

    letter-spacing: 4px;
    animation-duration: 0.8s;
    animation-name: letterSpacing4;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    // background-image: linear-gradient(
    //   225deg,
    //   var(--color-primary),
    //   var(--color-primary)
    // );

    img {
      height: 78px;
      border-radius: 0.125em;
      margin-right: 24px;
    }
  }
  .subtitle {
    font-size: 18px;
    letter-spacing: 1px;
    margin: 28px 0 54px 0;
    animation-duration: 0.8s;
    animation-name: letterSpacing1;
    text-transform: uppercase;
    color: var(--color-text);
  }
  .buttons {
    margin-top: 32px;
    display: flex;
    justify-content: center;
    button {
      margin-right: 16px;
    }
  }
}

.gradient {
  background: linear-gradient(to left, #dd2476, #ff512f);
}
</style>
