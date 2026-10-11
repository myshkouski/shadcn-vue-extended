<script setup lang="ts">
import type { ScrollAreaRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils.ts'

export interface SerialTerminalOutputProps extends ScrollAreaRootProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<SerialTerminalOutputProps>()
</script>

<template>
  <div
    :class="cn(
      'h-full overflow-hidden',
      props.class,
    )"
  >
    <ScrollArea class="h-full *:data-[slot=scroll-area-viewport]:[overflow-anchor:none]">
      <slot />
    </ScrollArea>
  </div>
</template>
