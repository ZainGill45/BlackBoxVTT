<script setup lang="ts">
import { ref } from 'vue';

const deletePrimeTime = 5000;
let deletePrimed = ref(false);

const primeDeleteButton = () => {
  deletePrimed.value = true;
  setTimeout(() => deletePrimed.value = false, deletePrimeTime);
}

defineProps<{
  buttonText: string;
  buttonFunction?: Function;
}>();
</script>

<template>
  <button type="button"
          class="flex h-8 w-fit text-nowrap px-3 items-center justify-center border border-neutral-700 bg-neutral-950 text-xs text-neutral-300 transition-all ease-out duration-128
                 hover:cursor-pointer hover:border-neutral-400
                 active:bg-neutral-950"
          :class="deletePrimed ? 'bg-neutral-300! border-neutral-300! text-neutral-900' : ''"
          @click="deletePrimed ? (buttonFunction && buttonFunction()) : primeDeleteButton()">{{ buttonText }}</button>
</template>
