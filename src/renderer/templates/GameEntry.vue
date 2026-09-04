<script setup lang="ts">
import { loadGame } from "../gameInitializationController";
import { deleteGameEntry } from "../gameEntryController";
import { Game } from "../../shared/schemas/game";

import DeleteIconButton from "./DeleteIconButton.vue";
import DefaultButton from "./DefaultButton.vue";

const props = defineProps<{
  game: Game;
}>();

const deleteEntryRequested = async (): Promise<void> => {
  await deleteGameEntry({
    schemaVersion: props.game.schemaVersion,
    uuid: props.game.uuid,
    name: props.game.name,
    gameSizeBytes: props.game.gameSizeBytes,
  });
};

const enterGameRequested = () => {
  loadGame({
    schemaVersion: props.game.schemaVersion,
    uuid: props.game.uuid,
    name: props.game.name,
    gameSizeBytes: props.game.gameSizeBytes,
  });
};
</script>

<template>
  <div>
    <div class="flex h-8 items-center gap-2">
      <div class="h-full w-full flex items-center bg-neutral-900 border border-neutral-600">
        <p class="text-xs ml-1.5">{{ game.name }}</p>
      </div>
      <div class="w-fit flex justify-center items-center gap-2">
        <DefaultButton buttonText="Enter" @click="enterGameRequested" />
        <DeleteIconButton @click="deleteEntryRequested" />
      </div>
    </div>
  </div>
</template>
