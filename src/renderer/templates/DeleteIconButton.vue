<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const deletePrimeTime = 5000;
const deletePrimed = ref(false);
let deletePrimeTimeout: number | undefined;

const resetDeleteConfirmation = (): void => {
  deletePrimed.value = false;

  if (deletePrimeTimeout !== undefined) {
    window.clearTimeout(deletePrimeTimeout);
    deletePrimeTimeout = undefined;
  }
};

const handleClick = (event: MouseEvent): void => {
  if (deletePrimed.value) {
    resetDeleteConfirmation();
    emit("click", event);
    return;
  }

  deletePrimed.value = true;
  deletePrimeTimeout = window.setTimeout(resetDeleteConfirmation, deletePrimeTime);
};

onUnmounted(resetDeleteConfirmation);
</script>

<template>
  <button type="button" class="flex h-8 w-8 text-nowrap px-1 items-center justify-center border border-neutral-700 bg-neutral-950 text-xs text-neutral-300 transition-[bg] ease-out duration-128 hover:cursor-pointer hover:border-neutral-500 active:bg-neutral-950" :class="deletePrimed ? 'bg-neutral-300! border-neutral-300! text-neutral-900' : ''" @click="handleClick" title="Delete">
    <span class="material-symbols-sharp text-neutral-500 select-none" :class="deletePrimed ? 'text-neutral-900!' : ''" style="font-weight: 300" :style="deletePrimed ? 'font-size: 24px' : 'font-size: 22px'">
      {{ deletePrimed ? "check" : "delete" }}
    </span>
  </button>
</template>
