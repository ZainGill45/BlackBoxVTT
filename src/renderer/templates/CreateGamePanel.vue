<script setup lang="ts">
import { ref } from "vue";
import { addGameEntry, gameEntries } from "../gameEntryController.js";
import { log } from "../logger.js";
import { toast } from "../toast.js";

import DefaultTextInput from "./DefaultTextInput.vue";
import DefaultButton from "./DefaultButton.vue";
import GameEntry from "./GameEntry.vue";

const gameNameInputValue = ref<string>("");

const importGame = (): void => {
  toast("Importing game...", "Attempting to import a game...");
  log("Attempting to import a game...");
};

const initCreateGame = async (): Promise<void> => {
  try {
    await addGameEntry(gameNameInputValue.value);
    log(`Added game entry for ${gameNameInputValue.value}`);
    toast("Operation Succeeded", `Game "${gameNameInputValue.value}" has been created`);
    gameNameInputValue.value = "";
  } catch (error) {
    log(`initCreateGame: ${error}`, "error");
    toast("Operation Failed", error, "error");
  }
};
</script>

<template>
  <div class="h-full w-full flex flex-col items-center justify-center gap-2">
    <div class="flex w-full gap-2">
      <DefaultTextInput identifier="game-name" placeholder="Enter Game Name" v-model="gameNameInputValue" @keyup.enter="initCreateGame" />
      <DefaultButton buttonText="Create" @click="initCreateGame" />
      <DefaultButton buttonText="Import" @click="importGame" />
    </div>
    <div class="w-full flex flex-col gap-2" v-show="gameEntries.length > 0">
      <GameEntry v-for="gameEntry in gameEntries" :key="gameEntry.uuid" :game="gameEntry" />
    </div>
  </div>
</template>
