<script setup lang="ts">
import type { Toast } from "../toast";

const borderColors: Record<string, string> = {
  info: "border-neutral-600",
  warning: "border-amber-300",
  error: "border-red-500",
};

const textColors: Record<string, string> = {
  info: "text-neutral-300",
  warning: "text-amber-300",
  error: "text-red-500",
};

defineProps<{
  toast: Toast;
}>();
</script>

<template>
  <div>
    <div class="flex flex-col gap-1 pt-3 pb-4 px-3 bg-linear-to-b from-neutral-800 via-neutral-900 to-neutral-950 shadow-lg shadow-black/50 border" :class="borderColors[toast.type]">
      <h2 class="text-sm font-medium" :class="textColors[toast.type]">{{ toast.title }}</h2>
      <p class="text-xs" :class="textColors[toast.type]">{{ toast.content }}</p>
    </div>
  </div>
</template>
