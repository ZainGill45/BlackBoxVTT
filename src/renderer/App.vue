<script setup lang="ts">
import HorizontalRule from './HorizontalRule.vue';
import DefaultButton from './DefaultButton.vue';
import LogMessage from './LogMessage.vue';

import { ref, onMounted, onUnmounted } from 'vue';

type TabName = 'join' | 'create';

const activeTab = ref<TabName>('join');
const consoleOpen = ref(false);

const handleTabSwitch = (tab: TabName) => { activeTab.value = tab; };
const requestExitApplication = () => window.electronAPI.requestApplicationExit();
const connectToServer = () => { window.electronAPI.requestLogUpdate('Attempting to connect to server...'); };
const importGame = () => { window.electronAPI.requestLogUpdate('Attempting to import a game...'); };
const createGame = () => { window.electronAPI.requestLogUpdate('Attempting to create a game...'); };

const toggleConsole = () => {
  consoleOpen.value = !consoleOpen.value;
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.code === 'Backquote') {
    event.preventDefault();
    toggleConsole();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div class="w-screen h-screen fixed bg-zinc-950/75 z-1000 px-4 py-3" v-if="consoleOpen" id="log-prompt">
    <div class="w-screen h-32/33 flex flex-col gap-1 px-4" id="log-content">
      <LogMessage />
    </div>
    <div class="w-sceen h-full border">
      <input type="text" class="w-full h-8 bg-neutral-900 text-xs text-neutral-300 px-2 border border-neutral-600 focus:border-neutral-400" placeholder="Enter command..." />
    </div>
  </div>
  <main class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <button type="button" class="absolute top-6 right-8 cursor-pointer hover:opacity-80 focus:opacity-80" @click="requestExitApplication">
      <span class="material-symbols-sharp text-neutral-50">close</span>
    </button>
    <div class="bg-grid-overlay flex h-full w-full items-center justify-center">
      <section class="flex w-2/7 flex-col items-center gap-2 border border-neutral-600 bg-linear-to-b from-neutral-800 via-neutral-900 to-neutral-950 p-2 pb-2.5 shadow-lg shadow-black/50">
        <div class="flex w-full items-center gap-2">
          <button type="button" class="flex h-10 w-full items-center justify-center border border-neutral-600 bg-neutral-900 text-sm text-neutral-300
                                       hover:cursor-pointer hover:border-neutral-400 
                                       active:bg-neutral-950
                                       focus:bg-neutral-950" :class="activeTab === 'join' ? 'bg-neutral-950' : ''" @click="handleTabSwitch('join')">Join Game</button>
          <button type="button" class="flex h-10 w-full items-center justify-center border border-neutral-600 bg-neutral-900 text-sm text-neutral-300
                                       hover:cursor-pointer hover:border-neutral-400 
                                       active:bg-neutral-950
                                       focus:bg-neutral-950" :class="activeTab === 'create' ? 'bg-neutral-950' : ''" @click="handleTabSwitch('create')">Create Game</button>
        </div>
        <HorizontalRule />
        <div class="h-full w-full flex flex-col items-center justify-center gap-2" :class="activeTab === 'join' ? '' : 'hidden'" id="join-game-content">
          <div class="flex w-full gap-2">
            <input type="text" id="server-ip" name="server-ip" placeholder="Enter Server IP" class="h-8 w-full border border-neutral-600 bg-neutral-950 px-2 text-xs text-neutral-300
                          focus:border-neutral-400" />
            <input type="text" id="server-port" name="server-port" placeholder="Enter Port" class="h-8 w-28 border border-neutral-600 bg-neutral-950 px-2 text-xs text-neutral-300
                          focus:border-neutral-400" />
            <DefaultButton buttonText="Connect" v-bind:buttonFunction="connectToServer" />
          </div>
        </div>
        <div class="h-full w-full flex flex-col items-center justify-center gap-2" :class="activeTab === 'create' ? '' : 'hidden'" id="create-game-content">
          <div class="flex w-full gap-2">
            <input type="text" id="server-ip" name="server-ip" placeholder="Enter Game Name" class="h-8 w-full border border-neutral-600 bg-neutral-950 px-2 text-xs text-neutral-300
                                      focus:border-neutral-400" />
            <DefaultButton buttonText="Create" v-bind:buttonFunction="createGame" />
            <DefaultButton buttonText="Import" v-bind:buttonFunction="importGame" />
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
