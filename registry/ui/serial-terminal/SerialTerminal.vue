<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import prettyBytes from 'pretty-bytes'
import { shallowRef, useTemplateRef, watch } from 'vue'
import SerialTerminalInput from './SerialTerminalInput.vue'
import SerialTerminalOutput from './SerialTerminalOutput.vue'
import SerialTerminalOutputLine from './SerialTerminalOutputLine.vue'
import { useTerminalOutput } from './useTerminalOutput.ts'

export interface SerialTerminalProps {
  class?: HTMLAttributes['class']
  maxEntries?: number
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  autofocus?: boolean
}

export interface SerialTerminalEmits {
  (e: 'send', payload: { content: string }): void
  (e: 'clear'): void
}

const props = withDefaults(defineProps<SerialTerminalProps>(), {
  maxEntries: Number.POSITIVE_INFINITY,
  placeholder: '',
  disabled: false,
  autofocus: false,
})

const emit = defineEmits<SerialTerminalEmits>()

const truncated = shallowRef<number | bigint>(0n)
const { entries, append, clear: clearOutput } = useTerminalOutput({
  maxEntries: () => props.maxEntries,
  onTruncate(entries) {
    for (const entry of entries) {
      if (typeof truncated.value === 'bigint') {
        truncated.value += BigInt(entry.content.length)
      }
      else {
        truncated.value += entry.content.length
      }
    }
  },
})

const output = useTemplateRef('output')

function clear(): void {
  clearOutput()
  emit('clear')
}

function scrollToBottom() {
  output.value?.scrollToBottom()
}

function handleSend(content: string): void {
  if (!content.trim() || props.disabled) {
    return
  }

  append(content, 'input')

  emit('send', { content })
}

defineExpose({
  write: append,
  clear,
})

watch(entries, () => {
  scrollToBottom()
}, {
  flush: 'post',
  deep: 2,
})
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

    <SerialTerminalOutput
      ref="output"
    >
      <p
        v-if="truncated > 0"
        class="text-muted-foreground text-xs mb-2 italic"
      >
        {{ prettyBytes(truncated, { space: false }) }} truncated
      </p>

      <p v-if="!entries?.length" class="text-muted-foreground text-xs italic select-none">
        No output yet. Type a command and press Enter.
      </p>

      <template v-else>
        <SerialTerminalOutputLine
          v-for="entry in entries"
          :key="entry.id"
          :entry="entry"
        />
      </template>
    </SerialTerminalOutput>

    <SerialTerminalInput class="flex-0" @send="handleSend" />
  </div>
</template>
