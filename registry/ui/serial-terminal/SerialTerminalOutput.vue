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
  <ScrollArea
    :class="cn(
      'flex-1 h-full overflow-hidden p-4',
      props.class,
    )"
  >
    <slot />
  </ScrollArea>
</template>
