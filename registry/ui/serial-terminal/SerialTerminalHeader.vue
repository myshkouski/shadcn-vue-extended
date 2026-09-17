<script setup lang="ts">

import { TerminalIcon } from "@lucide/vue"

export interface SerialTerminalHeaderProps {
  title?: string
}

const props = defineProps<SerialTerminalHeaderProps>()

const emit = defineEmits<{
  (type: 'clear'): void
}>()

</script>

<template>

  <div class="flex items-center justify-between gap-2 border-b bg-sub px-4 py-2 select-none">
    <div class="flex items-center gap-2">
      <TerminalIcon class="size-3.5" />
      <span v-if="props.title" class="text-xs font-medium">{{ props.title }}</span>
    </div>
    <div class="flex items-center gap-1">
      <slot />
    </div>
  </div>

</template>
