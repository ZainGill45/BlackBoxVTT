<script setup lang="ts">
import { ref, nextTick, watch, onMounted, onUnmounted } from "vue";
import { log, logs } from "../logger.js";

import DefaultTextInput from "./DefaultTextInput.vue";
import LogEntry from "./LogEntry.vue";

let consoleInputTraversalIndex: number = -1;

const availableCommands: Record<string, string> = {
  help: "help",
  clear: "clear",
  ping: "ping",
  playbyplay: "playbyplay",
};
const consoleLogContainer = ref<HTMLElement | null>(null);
const consoleInputHistory: string[] = [];
const consoleInput = ref("");
const consoleOpen = ref(false);

const vFocus = {
  mounted: (element: HTMLElement) => element.focus(),
};

const handleCommand = async (): Promise<void> => {
  const commandInput = consoleInput.value.toLocaleLowerCase().trim();

  if (commandInput === "")
    return;

  consoleInputHistory.push(commandInput);
  consoleInput.value = "";

  consoleInputTraversalIndex = -1;

  switch (commandInput) {
    case availableCommands["help"]:
      log("Available commands: help, clear, ping");
      break;
    case availableCommands["clear"]:
      logs.value.length = 0;
      break;
    case availableCommands["ping"]:
      log("pong!");
      break;
    default:
      log("Error command not recognized available commands: help, clear, ping", "error");
  }
};
const traverseConsoleHistory = (history: string[], direction: "up" | "down"): void => {
  if (history.length === 0)
    return;

  if (direction === "up") {
    if (consoleInputTraversalIndex === 0) {
      return;
    } else if (consoleInputTraversalIndex === -1) {
      consoleInputTraversalIndex = history.length - 1;
    } else {
      consoleInputTraversalIndex--;
    }
  } else if (direction === "down") {
    if (consoleInputTraversalIndex === -1) {
      return;
    } else if (consoleInputTraversalIndex === history.length - 1) {
      consoleInputTraversalIndex = -1;
      consoleInput.value = "";
      return;
    } else {
      consoleInputTraversalIndex++;
    }
  }

  if (consoleInputTraversalIndex >= 0 && history[consoleInputTraversalIndex] !== undefined) {
    consoleInput.value = history[consoleInputTraversalIndex] ?? "";
  }
};

watch(() => logs.value.length, async () => {
  await nextTick();

  if (consoleLogContainer.value) {
    const isScrolledToBottom = consoleLogContainer.value.scrollHeight - consoleLogContainer.value.scrollTop <= consoleLogContainer.value.clientHeight + 64;

    if (!isScrolledToBottom)
      return;

    consoleLogContainer.value.scrollTop = consoleLogContainer.value.scrollHeight;
  }
});

const toggleConsole = async (): Promise<void> => {
  consoleOpen.value = !consoleOpen.value;

  await nextTick();

  if (consoleLogContainer.value) {
    consoleLogContainer.value.scrollTop = consoleLogContainer.value.scrollHeight;
  }
};
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.code === "Backquote") {
    event.preventDefault();
    toggleConsole();
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});
onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});
</script>

<template>
  <div class="w-screen h-screen fixed bg-zinc-950/75 z-1000 px-4 py-3" v-if="consoleOpen">
    <div class="w-full h-32/33 flex flex-col gap-1 px-4 overflow-y-scroll" ref="consoleLogContainer">
      <LogEntry v-for="log in logs" :key="log.id" :log="log" />
    </div>
    <div class="w-sceen h-full border">
      <DefaultTextInput identifier="command-input" placeholder="Enter Command..." v-model="consoleInput" @keydown.enter="handleCommand" @keydown.up="traverseConsoleHistory(consoleInputHistory, 'up')" @keydown.down="traverseConsoleHistory(consoleInputHistory, 'down')" v-focus />
    </div>
  </div>
</template>
