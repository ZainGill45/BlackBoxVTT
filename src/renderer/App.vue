<script setup lang="ts">

</script>

<template>
  <main class="w-screen h-screen bg-zinc-950">
    <div class="h-screen w-screen flex justify-center items-center bg-grid-overlay">
      <div class="w-1/4 h-1/4 flex flex-col items-center px-3 py-2 bg-linear-to-b from-zinc-900 to-zinc-950 to-zinc-900 border border-zinc-600 shadow-lg shadow-zinc-900">
        <div class="w-full h-1/5 flex items-center gap-2">
          <div class="w-full h-10/12 flex justify-center items-center border border-zinc-500 bg-neutral-900
                      hover:border-zinc-400 hover:cursor-pointer
                      active:bg-zinc-950
                      focus:bg-zinc-950">
            <p class="text-sm text-zinc-300 leading-none select-none" style="text-box-trim: trim-both; text-box-edge: cap alphabetic;">Join Game</p>
          </div>
          <div class="w-full h-10/12 flex justify-center items-center border border-zinc-500 bg-zinc-900
                      hover:border-zinc-400 hover:cursor-pointer
                      active:bg-zinc-950
                      focus:bg-zinc-950">
            <p class="text-sm text-zinc-300 leading-none select-none" style="text-box-trim: trim-both; text-box-edge: cap alphabetic;">Create Game</p>
          </div>
        </div>
        <div class="w-full h-full"></div>
      </div>
    </div>
  </main>
</template>
