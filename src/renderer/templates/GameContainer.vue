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

type SelectedLayer = 'map' | 'token' | 'gm';
const selectedLayer = ref<SelectedLayer>('token');

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
      <DefaultIconButton iconName="arrow_selector_tool" ariaLabel="Select Tool" :class="selectedTool === 'select' ? 'border-neutral-400!' : ''" @click="selectedTool = 'select'"/>
      <DefaultIconButton iconName="design_services" ariaLabel="Measure Tool" :class="selectedTool === 'measure' ? 'border-neutral-400!' : ''" @click="selectedTool = 'measure'"/>
      <DefaultIconButton iconName="palette" ariaLabel="Paint Tool" :class="selectedTool === 'paint' ? 'border-neutral-400!' : ''" @click="selectedTool = 'paint'"/>
      <DefaultIconButton iconName="category" ariaLabel="Shape Tool" :class="selectedTool === 'shape' ? 'border-neutral-400!' : ''" @click="selectedTool = 'shape'"/>
      <DefaultIconButton iconName="text_fields" ariaLabel="Text Tool" :class="selectedTool === 'text' ? 'border-neutral-400!' : ''" @click="selectedTool = 'text'"/>
      <DefaultIconButton iconName="foggy" ariaLabel="Fog Tool" :class="selectedTool === 'fog' ? 'border-neutral-400!' : ''" @click="selectedTool = 'fog'"/>
    </div>
    <div class="w-8 flex flex-col gap-1.5 absolute bottom-4 left-4">
      <DefaultIconButton iconName="crown" ariaLabel="GM Layer" :class="selectedLayer === 'gm' ? 'border-neutral-400!' : ''" @click="selectedLayer = 'gm'"/>
      <DefaultIconButton iconName="token" ariaLabel="Token Layer" :class="selectedLayer === 'token' ? 'border-neutral-400!' : ''" @click="selectedLayer = 'token'"/>
      <DefaultIconButton iconName="map" ariaLabel="Map Layer" :class="selectedLayer === 'map' ? 'border-neutral-400!' : ''" @click="selectedLayer = 'map'"/>
    </div>
    <PixiCanvas class="w-screen h-screen z-0" />
    <div :style="{width: `${rightSidebarWidth}px`}" class="h-screen flex flex-col bg-neutral-900 border-l border-neutral-700 shadow-xl shadow-neutral-800 absolute right-0 top-0" >
      <div class="w-full h-12 flex bg-neutral-800/500 border-b border-neutral-700">
        <button class="w-full flex items-center justify-center border-r border-neutral-700">
          <span class="material-symbols-sharp text-neutral-400" style="font-size: 23px; font-weight: 200">chat</span>
        </button>
        <button class="w-full flex items-center justify-center border-r border-neutral-700">
          <span class="material-symbols-sharp text-neutral-400" style="font-size: 23px; font-weight: 200">map</span>
        </button>
        <button class="w-full flex items-center justify-center border-r border-neutral-700">
          <span class="material-symbols-sharp text-neutral-400" style="font-size: 23px; font-weight: 200">book</span>
        </button>
        <button class="w-full flex items-center justify-center border-r border-neutral-700">
          <span class="material-symbols-sharp text-neutral-400" style="font-size: 23px; font-weight: 200">storage</span>
        </button>
        <button class="w-full flex items-center justify-center border-r border-neutral-700">
          <span class="material-symbols-sharp text-neutral-400" style="font-size: 23px; font-weight: 200">music_note</span>
        </button>
        <button class="w-full flex items-center justify-center">
          <span class="material-symbols-sharp text-neutral-400" style="font-size: 23px; font-weight: 200">settings</span>
        </button>
      </div>
      <div class="w-full h-full"></div>
    </div>
  </div>
</template>
