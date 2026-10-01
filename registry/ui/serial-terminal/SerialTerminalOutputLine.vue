<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'
import { cn } from '@/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import { Primitive } from 'reka-ui'
import { computed } from 'vue'

export interface SerialTerminalOutputLineProps extends PrimitiveProps {
  entry: TerminalLineEntry
  class?: HTMLAttributes['class']
}

const props = defineProps<SerialTerminalOutputLineProps>()

const delegatedProps = reactiveOmit(props, ['entry', 'class'])

const TRAILING_BREAKS = /[\r\n]+$/

// A text line keeps the break that ended it, so that concatenating the lines
// gives the stream back for copying. Rendering it would add a blank line, so the
// break is left out of the display and out of the line's text: the entry it is
// read from never changes, and neither does this.
const text = computed(() => props.entry.content.replace(TRAILING_BREAKS, ''))
</script>

<template>
  <Primitive
    v-bind="delegatedProps"
    :class="cn(
      'flex w-full items-center',
      props.entry.type === 'input' && 'text-primary',
      props.entry.type === 'system' && 'text-muted-foreground italic',
      props.entry.type === 'output' && 'text-foreground',
      props.class,
    )"
  >
    <!-- <span class="shrink-0 text-muted-foreground select-none mr-2">
      {{ entry.type === 'input' ? '>' : entry.type === 'output' ? '$' : '·' }}
    </span> -->
    <span class="flex-1 text-sm font-mono whitespace-pre-wrap">
      {{ text }}
    </span>
    <!-- <span
      v-if="entry.droppedBytes"
      class="text-xs text-muted-foreground/50 shrink-0"
      :title="`${entry.droppedBytes} bytes truncated`"
    >…</span> -->
    <!-- <span class="select-none text-xs text-muted-foreground/50 text-nowrap">{{ entry.id }}</span> -->
  </Primitive>
</template>
