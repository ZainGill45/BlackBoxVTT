<script setup lang="ts">
defineProps<{
  iconName: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const handleClick = (event: MouseEvent): void => {
  emit("click", event);
};
</script>

<template>
  <button type="button" class="flex h-7.5 w-7.5 text-nowrap px-1 items-center justify-center border border-neutral-700 bg-neutral-900 text-xs text-neutral-300 transition-[bg] ease-out duration-128 hover:cursor-pointer hover:border-neutral-400 active:bg-neutral-950" :aria-label="ariaLabel" :title="ariaLabel" @click="handleClick">
    <span class="material-symbols-sharp text-neutral-400 select-none" style="font-size: 20px; font-weight: 300">{{ iconName }}</span>
  </button>
</template>
