<script setup lang="ts">
import { toasts } from '../toast';
import ToastEntry from './ToastEntry.vue';
</script>

<template>
  <div class="perspective-distant transform-3d flex flex-col gap-3 justify-end fixed bottom-4 right-4 w-96 h-96 overflow-hidden">
    <TransitionGroup name="toast">
      <ToastEntry v-for="toast in toasts" :key="toast.id" :toast="toast"/>
    </TransitionGroup>
  </div>
</template>
