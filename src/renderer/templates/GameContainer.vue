<script setup lang="ts">
import { exitGame } from "../gameInitializationController.js";
import { rightSidebarWidth } from "../dataStore.js"
import { toast } from "../toast.js";
import { log } from "../logger.js";
import { ref } from "vue";

import PixiCanvas from "./PixiCanvas.vue";
import DefaultIconButton from "./DefaultIconButton.vue";

type SelectedTool = 'select' | 'measure' | 'paint' | 'shape' | 'text' | 'fog';
const selectedTool = ref<SelectedTool>('select');

const switchSelectedTool = (tool: SelectedTool) => {
  selectedTool.value = tool;
}

type SelectedLayer = 'map' | 'token' | 'gm';
const selectedLayer = ref<SelectedLayer>('token');

const switchSelectedLayer = (layer: SelectedLayer) => {
  selectedLayer.value = layer;
}

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
      <DefaultIconButton iconName="arrow_selector_tool" ariaLabel="Select Tool" :class="selectedTool === 'select' ? 'border-neutral-400!' : ''" @click="switchSelectedTool('select')"/>
      <DefaultIconButton iconName="design_services" ariaLabel="Measure Tool" :class="selectedTool === 'measure' ? 'border-neutral-400!' : ''" @click="switchSelectedTool('measure')"/>
      <DefaultIconButton iconName="palette" ariaLabel="Paint Tool" :class="selectedTool === 'paint' ? 'border-neutral-400!' : ''" @click="switchSelectedTool('paint')"/>
      <DefaultIconButton iconName="category" ariaLabel="Shape Tool" :class="selectedTool === 'shape' ? 'border-neutral-400!' : ''" @click="switchSelectedTool('shape')"/>
      <DefaultIconButton iconName="text_fields" ariaLabel="Text Tool" :class="selectedTool === 'text' ? 'border-neutral-400!' : ''" @click="switchSelectedTool('text')"/>
      <DefaultIconButton iconName="foggy" ariaLabel="Fog Tool" :class="selectedTool === 'fog' ? 'border-neutral-400!' : ''" @click="switchSelectedTool('fog')"/>
    </div>
    <div class="w-8 flex flex-col gap-1.5 absolute bottom-4 left-4">
      <DefaultIconButton iconName="crown" ariaLabel="GM Layer" :class="selectedLayer === 'gm' ? 'border-neutral-400!' : ''" @click="switchSelectedLayer('gm')"/>
      <DefaultIconButton iconName="token" ariaLabel="Token Layer" :class="selectedLayer === 'token' ? 'border-neutral-400!' : ''" @click="switchSelectedLayer('token')"/>
      <DefaultIconButton iconName="map" ariaLabel="Map Layer" :class="selectedLayer === 'map' ? 'border-neutral-400!' : ''" @click="switchSelectedLayer('map')"/>
    </div>
    <PixiCanvas class="w-screen h-screen z-0" />
    <div class="h-screen bg-neutral-900 border-l border-neutral-700 absolute right-0 top-0" :style="{width: `${rightSidebarWidth}px`}" >

    </div>
  </div>
</template>
