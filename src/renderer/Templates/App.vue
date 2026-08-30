<script setup lang="ts">
import { ref } from 'vue';
import { log } from '../logger.js';
import { toast } from '../toast.js';

import GameEntryContainer from './GameEntryContainer.vue';
import DefaultTextInput from './DefaultTextInput.vue';
import ConsoleContainer from './ConsoleContainer.vue';
import HorizontalRule from './HorizontalRule.vue';
import ToastContainer from './ToastContainer.vue';
import DefaultButton from './DefaultButton.vue';
import { addGameEntry } from '../gameEntryController.js';

type TabName = 'join' | 'create';

const activeTab = ref<TabName>('join');
const gameNameInputValue = ref<string>('');

const handleTabSwitch = (tab: TabName): void => { activeTab.value = tab; };
const requestExitApplication = (): Promise<void> => window.electronAPI.requestApplicationExit();
const connectToServer = (): void => {
  toast('Connecting to server...', 'Attempting to connect to server please wait a few moments...');
  log('Attempting to connect to server...');
};
const importGame = (): void => {
  toast('Importing game...', 'Attempting to import a game...');
  log('Attempting to import a game...');
};
const initCreateGame = (): void => {
  log('Attempting to create a game...');
  addGameEntry(gameNameInputValue.value);
  gameNameInputValue.value = '';
};
</script>

<template>
  <ConsoleContainer />
  <ToastContainer />
  <main class="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
    <button type="button" class="absolute top-6 right-8 cursor-pointer hover:opacity-80 focus:opacity-80" @click="requestExitApplication">
      <span class="material-symbols-sharp text-neutral-50">close</span>
    </button>
    <div class="bg-grid-overlay flex h-full w-full items-center justify-center">
      <section class="flex w-2/7 flex-col items-center gap-2 border border-neutral-600 bg-linear-to-b from-neutral-800 via-neutral-900 to-neutral-950 p-2 pb-2.5 shadow-lg shadow-black/50">
        <div class="flex w-full items-center">
          <DefaultButton buttonText="Join Game" v-bind:buttonFunction="() => handleTabSwitch('join')" :class="activeTab === 'join' ? 'bg-neutral-950' : ''" class="w-full! h-10! text-sm! border-r-0! hover:border-r!" />
          <DefaultButton buttonText="Create Game" v-bind:buttonFunction="() => handleTabSwitch('create')" :class="activeTab === 'create' ? 'bg-neutral-950' : ''" class="w-full! h-10! text-sm!" />
        </div>
        <HorizontalRule />
        <div class="h-full w-full flex flex-col items-center justify-center gap-2" :class="activeTab === 'join' ? '' : 'hidden'">
          <div class="flex w-full gap-2">
            <DefaultTextInput identifier="server-ip" placeholder="Enter Server IP" />
            <DefaultTextInput identifier="server-port" placeholder="Enter Port" class="w-28!" />
            <DefaultButton buttonText="Connect" v-bind:buttonFunction="connectToServer" />
          </div>
        </div>
        <div class="h-full w-full flex flex-col items-center justify-center gap-2" :class="activeTab === 'create' ? '' : 'hidden'">
          <div class="flex w-full gap-2">
            <DefaultTextInput identifier="game-name" placeholder="Enter Game Name" v-model="gameNameInputValue" />
            <DefaultButton buttonText="Create" v-bind:buttonFunction="initCreateGame" />
            <DefaultButton buttonText="Import" v-bind:buttonFunction="importGame" />
          </div>
          <GameEntryContainer />
        </div>
      </section>
    </div>
  </main>
</template>
