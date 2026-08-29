<script setup lang="ts">
import { uiLogs } from './renderer';
</script>

<template>
	<div v-for="log in uiLogs" :key="log.id">
		<p class="text-sm font-light font-mono py-1.5" :class="log.type === 'info' ? 'text-neutral-300' : 'text-amber-300'">{{ log.timestamp }}: {{ log.content }}</p>
		<hr class="border-b-0 border-neutral-500">
	</div>
</template>