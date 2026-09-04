<script setup lang="ts">
import { onUnmounted, ref } from "vue";

defineProps<{
  buttonText: string;
}>();

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
  <button type="button" class="flex h-8 w-fit text-nowrap px-3 items-center justify-center border border-neutral-700 bg-neutral-950 text-xs text-neutral-300 select-none transition-all ease-out duration-128 hover:cursor-pointer hover:border-neutral-400 active:bg-neutral-950" :class="deletePrimed ? 'bg-neutral-300! border-neutral-300! text-neutral-900' : ''" @click="handleClick">{{ buttonText }}</button>
</template>
