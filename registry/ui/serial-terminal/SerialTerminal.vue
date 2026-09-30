<script setup lang="ts">

import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

export interface SerialTerminalProps {
  class?: HTMLAttributes['class']
  // modelValue?: string
  // placeholder?: string
  // disabled?: boolean
  // autofocus?: boolean
}

export interface SerialTerminalEmits {
  // (e: 'send', payload: { content: string }): void
  // (e: 'clear'): void
}

const props = withDefaults(defineProps<SerialTerminalProps>(), {
  // disabled: false,
  // autofocus: false,
})

const emit = defineEmits<SerialTerminalEmits>()

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
