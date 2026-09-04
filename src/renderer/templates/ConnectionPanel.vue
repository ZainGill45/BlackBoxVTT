<script setup lang="ts">
import { ref } from "vue";
import { log } from "../logger.js";
import { toast } from "../toast.js";

import HorizontalRule from "./HorizontalRule.vue";
import DefaultButton from "./DefaultButton.vue";
import DefaultIconButton from "./DefaultIconButton.vue";
import JoinGamePanel from "./JoinGamePanel.vue";
import CreateGamePanel from "./CreateGamePanel.vue";

const handleTabSwitch = (tab: TabName): void => {
  activeTab.value = tab;
};

type TabName = "join" | "create";

const activeTab = ref<TabName>("join");

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
  <section class="flex w-2/7 flex-col items-center gap-2 border border-neutral-600 bg-linear-to-b from-neutral-800 via-neutral-900 to-neutral-950 p-2 pb-2.5 shadow-lg shadow-black/50">
    <DefaultIconButton iconName="close" ariaLabel="Exit Application" class="absolute! top-6 right-8 inline-block! h-auto! w-auto! cursor-pointer! border-0! bg-transparent! p-0! text-neutral-50! transition-none! hover:border-transparent! hover:opacity-80 focus:opacity-80 active:bg-transparent! [&>span]:text-[24px]! [&>span]:font-normal! [&>span]:text-neutral-50!" @click="requestExitApplication" />
    <div class="flex w-full items-center">
      <DefaultButton buttonText="Join Game" :class="activeTab === 'join' ? 'bg-neutral-950' : ''" class="w-full! h-10! text-sm! border-r-0! hover:border-r!" @click="handleTabSwitch('join')" />
      <DefaultButton buttonText="Create Game" :class="activeTab === 'create' ? 'bg-neutral-950' : ''" class="w-full! h-10! text-sm!" @click="handleTabSwitch('create')" />
    </div>
    <HorizontalRule />
    <JoinGamePanel v-show="activeTab === 'join'" />
    <CreateGamePanel v-show="activeTab === 'create'" />
  </section>
</template>
