<template>
  <div class="controls">
    <div
      class="button minimize codicon codicon-chrome-minimize"
      @click="windowMinimize"
    ></div>
    <div
      class="button max-restore codicon"
      :class="{
        'codicon-chrome-restore': isMaximized,
        'codicon-chrome-maximize': !isMaximized,
      }"
      @click="windowMaxRestore"
    ></div>
    <div
      class="button close codicon codicon-chrome-close"
      @click="windowClose"
    ></div>
  </div>
</template>

<script>
// icons by https://github.com/microsoft/vscode-codicons
import 'vscode-codicons/dist/codicon.css';

const electron =
  process.env.IS_ELECTRON === true ? window.require('electron') : null;
const ipcRenderer =
  process.env.IS_ELECTRON === true ? electron.ipcRenderer : null;

export default {
  name: 'WindowControls',
  data() {
    return {
      isMaximized: false,
    };
  },
  created() {
    if (process.env.IS_ELECTRON === true) {
      ipcRenderer.on('isMaximized', (_, value) => {
        this.isMaximized = value;
      });
    }
  },
  methods: {
    windowMinimize() {
      ipcRenderer.send('minimize');
    },
    windowMaxRestore() {
      ipcRenderer.send('maximizeOrUnmaximize');
    },
    windowClose() {
      ipcRenderer.send('close');
    },
  },
};
</script>

<style lang="scss" scoped>
.controls {
  height: 32px;
  justify-content: flex-end;
  display: flex;
  .button {
    height: 100%;
    width: 46px;
    font-size: 16px;
    display: flex;
    justify-content: center;
    align-items: center;
    -webkit-app-region: no-drag;
    &:hover {
      background: var(--hover);
    }
    &:active {
      background: var(--active);
    }
    &.close {
      &:hover {
        background: #c42c1b;
        color: rgba(255, 255, 255, 0.8);
      }
      &:active {
        background: #f1707a;
        color: #000;
      }
    }
  }
}
</style>
