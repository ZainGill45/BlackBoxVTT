<script setup lang="ts">
import { log } from "../logger.js";
import { toast } from "../toast.js";

import DefaultTextInput from "./DefaultTextInput.vue";
import DefaultButton from "./DefaultButton.vue";

const connectToServer = (): void => {
  toast("Connecting to server...", "Attempting to connect to server please wait a few moments...");
  log("Attempting to connect to server...");
};
</script>

<template>
  <div class="h-full w-full flex flex-col items-center justify-center gap-2">
    <div class="flex w-full gap-2">
      <DefaultTextInput identifier="server-ip" placeholder="Enter Server IP" />
      <DefaultTextInput identifier="server-port" placeholder="Enter Port" class="w-28!" />
      <DefaultButton buttonText="Connect" @click="connectToServer" />
    </div>
  </div>
</template>
