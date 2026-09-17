<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { default as SerialTerminalInput } from './SerialTerminalInput.vue'
import { default as SerialTerminalOutput } from './SerialTerminalOutput.vue'
import { useTerminalOutput, type TerminalLineEntryType } from './useTerminalOutput.ts';
import { default as SerialTerminalOutputLine } from "./SerialTerminalOutputLine.vue"
import { default as prettyBytes } from "pretty-bytes"

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  maxEntries?: number
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  autofocus?: boolean
}>(), {
  maxEntries: Number.POSITIVE_INFINITY,
  placeholder: '',
  disabled: false,
  autofocus: false,
})

const emit = defineEmits<{
  (e: 'send', payload: { content: string }): void
  (e: 'clear'): void
}>()

const truncated = ref(0)
const { entries, append, clear: clearOutput } = useTerminalOutput({
  maxEntries: () => props.maxEntries,
  onTruncate(entries) {
    for (const entry of entries) {
      truncated.value += entry.content.length
    }
  }
})

const inputValue = defineModel('input', { default: '' })
const output = useTemplateRef('output')

function write(content: string, type: TerminalLineEntryType) {
  const lines = content.split(/\r?\n/)
  append(lines, type)
}

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

  write(content, 'input')
  inputValue.value = ''

  emit('send', { content })
}

defineExpose({
  write,
  clear,
})

watch(entries, () => {
  scrollToBottom()
}, {
  flush: "post",
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
      >{{ prettyBytes(truncated, { space: false }) }} truncated</p>

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
