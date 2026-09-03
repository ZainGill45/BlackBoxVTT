<script setup lang="ts">
import { currentAppState } from "../gameEnterController";

import ConsoleContainer from "./ConsoleContainer.vue";
import ConnectionPanel from "./ConnectionPanel.vue";
import ToastContainer from "./ToastContainer.vue";
import GameContainer from "./GameContainer.vue";
import LoadingAnimation from "./LoadingAnimation.vue";
</script>

<template>
  <ConsoleContainer />
  <ToastContainer />
  <main class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <div class="bg-grid-overlay flex h-full w-full items-center justify-center">
      <LoadingAnimation v-show="currentAppState === 'loading'" class="z-50 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      <Transition name="fade">
        <ConnectionPanel v-show="currentAppState === 'connection'" />
      </Transition>
      <Transition name="fade">
        <GameContainer v-show="currentAppState === 'game'" />
      </Transition>
    </div>
  </main>
</template>
