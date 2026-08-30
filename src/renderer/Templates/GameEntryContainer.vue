<script setup lang="ts">
import { gameEntries } from '../gameEntryController';

import GameEntry from './GameEntry.vue';
</script>

<template>
  <div class="w-full flex flex-col gap-2" v-show="gameEntries.length > 0">
    <GameEntry v-for="gameEntry in gameEntries" :key="gameEntry.id" :gameEntry="gameEntry"/>
  </div>
</template>
