<script setup lang="ts">
import { GameEntry } from '../gameEntryController';

import DefaultButton from './DefaultButton.vue';

defineProps<{
  gameEntry: GameEntry
}>();
</script>

<template>
  <div>
    <div class="flex h-8 items-center gap-2">
      <div class="h-full w-full flex items-center bg-neutral-900 border border-neutral-600">
        <p class="text-xs ml-1.5">{{ gameEntry.name }}</p>
      </div>
      <div class="w-fit flex justify-center items-center gap-2">
        <DefaultButton buttonText="Delete"/>
        <DefaultButton buttonText="Enter"/>
      </div>
    </div>
  </div>
</template>
