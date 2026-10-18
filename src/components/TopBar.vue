<script setup>
/** TopBar.vue —— 顶栏（品牌 + 视图操作按钮） */
defineProps({
  paused: { type: Boolean, default: false },
});
defineEmits(['global-view', 'fault-focus', 'toggle-pause']);
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="logo">⚡</span>
      <span class="title">电力实时拓扑可视化 POC</span>
    </div>
    <div class="actions">
      <button class="btn" @click="$emit('global-view')">全局视图</button>
      <button class="btn" @click="$emit('fault-focus')">故障聚焦</button>
      <button class="btn" :class="{ active: paused }" @click="$emit('toggle-pause')">
        {{ paused ? '继续' : '暂停' }}
      </button>
    </div>
  </header>
</template>
