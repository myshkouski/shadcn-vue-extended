<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

export interface SerialTerminalProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<SerialTerminalProps>()
</script>

<template>
  <div
    data-slot="serial-terminal"
    :class="cn(
      'flex flex-col rounded-lg border bg-background font-mono text-sm overflow-hidden',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
