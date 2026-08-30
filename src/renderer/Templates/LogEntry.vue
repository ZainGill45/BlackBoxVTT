<script setup lang="ts">
import { Log } from '../../shared/types/log';

const textColors: Record<string, string> = {
	info: 'text-neutral-300',
	warning: 'text-amber-300',
	error: 'text-red-500',
}
const borderColors: Record<string, string> = {
	info: 'border-neutral-800',
	warning: 'border-amber-300',
	error: 'border-red-500'
}

defineProps<{
  log: Log
}>();
</script>

<template>
	<div>
		<p class="text-sm font-light font-mono py-1.5" :class="textColors[log.type]">{{ log.timestamp }}: {{ log.content }}</p>
		<hr class="border-b-0" :class="borderColors[log.type]">
	</div>
</template>
