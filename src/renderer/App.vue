<script setup lang="ts">
const requestExitApplication = () => window.preload.exitApplication();
</script>

<template>
  <main class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <button type="button" class="absolute top-6 right-8 cursor-pointer" @click="requestExitApplication">
      <span class="material-icons-sharp text-neutral-50 hover:opacity-80" style="font-size: 32px;">close</span>
    </button>
    <div class="bg-grid-overlay flex h-full w-full items-center justify-center p-6">
      <section class="flex w-1/4 flex-col items-center border border-neutral-600 bg-linear-to-b from-neutral-800 via-neutral-900 to-neutral-950 p-2 shadow-lg shadow-black/50">
        <div class="flex w-full items-center gap-2">
          <button type="button" class="flex h-10 w-full items-center justify-center border border-neutral-600 bg-neutral-900 text-sm text-neutral-300
                                       hover:cursor-pointer hover:border-neutral-400 
                                       active:bg-neutral-950">Join Game</button>
          <button type="button" class="flex h-10 w-full items-center justify-center border border-neutral-600 bg-neutral-900 text-sm text-neutral-300
                                       hover:cursor-pointer hover:border-neutral-400 
                                       active:bg-neutral-950">Create Game</button>
        </div>
        <div class="h-full w-full"></div>
      </section>
    </div>
  </main>
</template>
