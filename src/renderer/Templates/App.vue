<script setup lang="ts">
import ConsoleContainer from './ConsoleContainer.vue';
import ConnectionPanel from './ConnectionPanel.vue';
import ToastContainer from './ToastContainer.vue';
import GameContainer from './GameContainer.vue';
</script>

<template>
  <ConsoleContainer />
  <ToastContainer />
  <main class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <div class="bg-grid-overlay flex h-full w-full items-center justify-center">
      <ConnectionPanel class="hidden"/>
      <GameContainer/>
    </div>
  </main>
</template>
