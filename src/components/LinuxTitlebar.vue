<template>
  <div class="linux-titlebar">
    <div class="logo">
      <img src="img/logos/yesplaymusic-white24x24.png" />
    </div>
    <div class="title">{{ title }}</div>
    <WindowControls />
  </div>
</template>

<script>
import { mapState } from 'vuex';
import WindowControls from '@/components/WindowControls.vue';

export default {
  name: 'LinuxTitlebar',
  components: { WindowControls },
  computed: {
    ...mapState(['title']),
  },
};
</script>

<style lang="scss" scoped>
.linux-titlebar {
  color: var(--color-text);
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  --hover: #e6e6e6;
  --active: #cccccc;

  .logo {
    padding: 0 8px;
  }

  .title {
    padding: 8px;
    font-size: 12px;
    font-family: 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
    justify-self: center;
    margin: 0 auto;
  }
}
[data-theme='dark'] .linux-titlebar {
  --hover: #191919;
  --active: #333333;
}
</style>
