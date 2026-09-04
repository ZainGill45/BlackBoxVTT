<script setup lang="ts">
import { exitGame } from "../gameInitializationController.js";
import { toast } from "../toast.js";
import { log } from "../logger.js";

import PixiCanvas from "./PixiCanvas.vue";
import DefaultIconButton from "./DefaultIconButton.vue";
const exitGameRequested = () => {
  exitGame();
};

const requestExitApplication = async () => {
  try {
    await window.electronAPI.requestApplicationExit();
  } catch (error) {
    log(`requestExitApplication: ${error}`, "error");
    toast("Operation Failure", `requestExitApplication: ${error}`, "error");
  }
};
</script>

<template>
  <div class="w-screen h-screen">
    <div class="flex flex-col gap-1.5 absolute top-4 left-4">
      <DefaultIconButton iconName="power_settings_new" ariaLabel="Exit Application" @click="requestExitApplication" />
      <DefaultIconButton iconName="logout" ariaLabel="Logout" @click="exitGameRequested" />
      <DefaultIconButton iconName="arrow_selector_tool" ariaLabel="Select Tool" />
      <DefaultIconButton iconName="design_services" ariaLabel="Measure Tool" />
      <DefaultIconButton iconName="palette" ariaLabel="Paint Tool" />
      <DefaultIconButton iconName="category" ariaLabel="Shape Tool" />
      <DefaultIconButton iconName="text_fields" ariaLabel="Text Tool" />
      <DefaultIconButton iconName="foggy" ariaLabel="Fog Tool" />
    </div>
    <div class="flex flex-col gap-1.5 absolute bottom-4 left-4">
      <DefaultIconButton iconName="crown" ariaLabel="GM Layer" />
      <DefaultIconButton iconName="token" ariaLabel="Token Layer" />
      <DefaultIconButton iconName="map" ariaLabel="Map Layer" />
    </div>
    <PixiCanvas class="w-screen h-screen z-0" />
    <div class="w-sm h-screen bg-neutral-800 border-l border-neutral-700 absolute right-0 top-0"></div>
  </div>
</template>
