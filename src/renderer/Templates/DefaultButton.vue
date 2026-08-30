<script setup lang="ts">
defineProps<{
    buttonText: string;
    buttonFunction?: () => void;
}>();
</script>

<template>
    <button type="button" class="flex h-8 w-fit text-nowrap px-3 items-center justify-center border border-neutral-600 bg-neutral-900 text-xs text-neutral-300
                               hover:cursor-pointer hover:border-neutral-400 
                               active:bg-neutral-950" @click="buttonFunction">{{ buttonText }}</button>
</template>