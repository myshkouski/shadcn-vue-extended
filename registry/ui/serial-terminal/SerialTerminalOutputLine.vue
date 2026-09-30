<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'
import { reactiveOmit, useClipboard } from '@vueuse/core'
import { Primitive } from 'reka-ui'
import { cn } from '~/lib/utils'

export interface SerialTerminalOutputLineProps extends PrimitiveProps {
  entry: TerminalLineEntry
  class?: HTMLAttributes['class']
}

const props = withDefaults(
  defineProps<SerialTerminalOutputLineProps>(),
  {
    // "as": "p"
  },
)

const delegatedProps = reactiveOmit(props, ['entry', 'class'])

const { copy, isSupported } = useClipboard()

function copyContent(entry: TerminalLineEntry) {
  const text = entry.content
  if (isSupported) {
    copy(text)
  }
}
</script>

<template>
  <Primitive
    v-bind="delegatedProps"
    :class="cn(
      'font-mono text-sm flex w-full items-center',
      props.entry.type === 'input' && 'text-primary',
      props.entry.type === 'system' && 'text-muted-foreground italic',
      props.entry.type === 'output' && 'text-foreground',
      props.class,
    )"
    @click="copyContent(entry)"
  >
    <span class="shrink-0 text-muted-foreground select-none mr-2">
      {{ entry.type === 'input' ? '>' : entry.type === 'output' ? '$' : '·' }}
    </span>
    <span>
      {{ entry.content }}
    </span>
  </Primitive>
</template>
