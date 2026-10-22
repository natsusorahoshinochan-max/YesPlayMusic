<template>
  <div class="win32-titlebar">
    <div class="title">{{ title }}</div>
    <WindowControls />
  </div>
</template>

<script>
import { mapState } from 'vuex';
import WindowControls from '@/components/WindowControls.vue';

export default {
  name: 'Win32Titlebar',
  components: { WindowControls },
  computed: {
    ...mapState(['title']),
  },
};
</script>

<style lang="scss" scoped>
.win32-titlebar {
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

  .title {
    padding: 8px 12px;
    font-size: 12px;
    font-family: 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  }
  .controls {
    margin-left: auto;
  }
}
[data-theme='dark'] .win32-titlebar {
  --hover: #191919;
  --active: #333333;
}
</style>
