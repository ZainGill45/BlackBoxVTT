<script setup lang="ts">
import { showFullScreenLoader, showConnectionPanel, showGameContainer } from '../gameEnterController';

import ConsoleContainer from './ConsoleContainer.vue';
import ConnectionPanel from './ConnectionPanel.vue';
import ToastContainer from './ToastContainer.vue';
import GameContainer from './GameContainer.vue';
import FullScreenLoader from './FullScreenLoader.vue';
</script>

<template>
  <ConsoleContainer/>
  <ToastContainer/>
  <main class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <div class="bg-grid-overlay flex h-full w-full items-center justify-center">
      <FullScreenLoader v-show="showFullScreenLoader"/>
      <ConnectionPanel v-show="showConnectionPanel"/>
      <GameContainer v-show="showGameContainer"/>
    </div>
  </main>
</template>
