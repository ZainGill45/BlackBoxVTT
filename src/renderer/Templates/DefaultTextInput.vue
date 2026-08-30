<script setup lang="ts">
const model = defineModel<string>();

defineProps<{
  identifier: string,
  placeholder: string,
}>();
</script>

<template>
  <input v-model="model" type="text" :id="identifier" :name="identifier" :placeholder="placeholder" v-bind="$attrs" class="h-8 w-full border border-neutral-600 bg-neutral-950 px-2 text-xs text-neutral-300 focus:border-neutral-400" />
</template>