<template>
  <div
    v-if="loading"
    class="page-loading"
    role="progressbar"
    aria-label="Loading"
  ></div>
</template>

<script>
export default {
  name: 'PageLoading',
  props: { loading: Boolean },
};
</script>

<style scoped>
.page-loading {
  position: fixed;
  z-index: 1031;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  pointer-events: none;
  background: var(--color-primary);
  transform-origin: left;
  opacity: 0;
  animation: loading 12s 1s forwards;
}

@keyframes loading {
  from {
    opacity: 1;
    transform: scaleX(0.08);
  }
  to {
    opacity: 1;
    transform: scaleX(0.95);
  }
}
</style>
