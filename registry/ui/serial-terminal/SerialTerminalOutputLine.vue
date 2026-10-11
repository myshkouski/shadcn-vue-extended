<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'
import { cn } from '@/lib/utils'
import { Primitive } from 'reka-ui'
import { computed } from 'vue'

export interface SerialTerminalOutputLineProps extends PrimitiveProps {
  entry: TerminalLineEntry
  class?: HTMLAttributes['class']
}

const props = defineProps<SerialTerminalOutputLineProps>()

// A plain spread rather than `reactiveOmit`: `entry` is either a frozen
// object the parent replaces rather than mutates, or the open line,
// which the parent grows in place and which is reactive, so neither
// ever needs unwrapping.
const { entry, class: _class, ...delegatedProps } = props

const TRAILING_BREAKS = /[\r\n]+$/

// A text line keeps the break that ended it, so that concatenating the lines
// gives the stream back for copying. Rendering it would add a blank line, so the
// break is left out of the display and out of the line's text: the entry it is
// read from never changes, and neither does this.
const text = computed(() => entry.content.replace(TRAILING_BREAKS, ''))
</script>

<template>
  <Primitive
    v-bind="delegatedProps"
    as="pre"
    :class="cn(
      'flex w-full items-center',
      entry.type === 'input' && 'text-primary',
      entry.type === 'system' && 'text-muted-foreground italic',
      entry.type === 'output' && 'text-foreground',
      props.class,
    )"
  >
    <!-- <span class="shrink-0 text-muted-foreground select-none mr-2">
      {{ entry.type === 'input' ? '>' : entry.type === 'output' ? '$' : '·' }}
    </span> -->
    <code class="flex-1 text-sm font-mono whitespace-pre-wrap">
      {{ text }}
    </code>
    <!-- <span
      v-if="entry.droppedBytes"
      class="text-xs text-muted-foreground/50 shrink-0"
      :title="`${entry.droppedBytes} bytes truncated`"
    >…</span> -->
    <!-- <span class="select-none text-xs text-muted-foreground/50 text-nowrap">{{ entry.id }}</span> -->
  </Primitive>
</template>
