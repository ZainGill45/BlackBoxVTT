<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { log, uiLogs } from '../logger.js';

import DefaultTextInput from './DefaultTextInput.vue';
import LogMessage from './LogMessage.vue';

const consoleInput = ref('');
const consoleOpen = ref(false);

const vFocus = {
  mounted: (element: HTMLElement) => element.focus()
}

const handleCommand = (): void => {
  const commandInput = consoleInput.value;

  if (commandInput === '')
    return;

  commandInput.toLowerCase();
  commandInput.trim();

  consoleInput.value = '';

  switch (commandInput) {
    case 'help':
      log('Available commands: help, clear, ping');
      break
    case 'clear':
      uiLogs.value.length = 0;
      break
    case 'ping':
      log("pong!");
      break
    default:
      log('Error command not recognized available commands: help, clear, ping', 'error');
  }
}

const toggleConsole = (): void => {
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
    <div class="w-full h-32/33 flex flex-col gap-1 px-4 overflow-y-scroll" id="log-content">
      <LogMessage />
    </div>
    <div class="w-sceen h-full border">
      <DefaultTextInput identifier="command-input" placeholder="Enter Command..." v-model="consoleInput" @keydown.enter="handleCommand" v-focus />
    </div>
  </div>
</template>