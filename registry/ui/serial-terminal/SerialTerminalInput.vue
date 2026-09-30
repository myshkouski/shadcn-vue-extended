<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { SerialTerminalNewLineToggleModelValue } from './SerialTerminalNewLineToggle.vue'
import { ArrowRightIcon } from '@lucide/vue'
import { cn } from '~/lib/utils'
import SerialTerminalNewLineToggle from './SerialTerminalNewLineToggle.vue'

export interface SerialTerminalInputProps {
  class?: HTMLAttributes['class']
  disabled?: boolean
  placeholder?: string
  autofocus?: boolean
}

export interface SerialTerminalInputEmits {
  (type: 'send', value: string): void
}

const props = defineProps<SerialTerminalInputProps>()
const emit = defineEmits<SerialTerminalInputEmits>()

const input = shallowRef('')
const inputHistory = ref<string[]>([])
const inputHistoryIndex = shallowRef(-1)

const newLine = ref<SerialTerminalNewLineToggleModelValue>('')

function handleSend() {
  let value = input.value
  inputHistory.value.unshift(input.value)
  inputHistoryIndex.value = -1
  input.value = ''

  if (newLine.value) {
    value += newLine.value
  }

  emit('send', value)
}

function onKeyDown(e: KeyboardEvent) {
  const key = e.key.toLowerCase()

  switch (key) {
    case 'arrowup':
      inputHistoryIndex.value = Math.max(0, inputHistoryIndex.value + 1) % inputHistory.value.length
      input.value = inputHistory.value.at(inputHistoryIndex.value) || ''
      break

    case 'arrowdown':
      inputHistoryIndex.value = Math.max(0, inputHistoryIndex.value - 1) % inputHistory.value.length
      input.value = inputHistory.value.at(inputHistoryIndex.value) || ''
      break

    case 'enter':
      if (e.shiftKey && !props.disabled) {
        e.preventDefault()
        handleSend()
      }
      break

    case 'backspace':
      if (e.ctrlKey && !props.disabled) {
        e.preventDefault()
        input.value = ''
      }
      break
  }
}

const inputRef = useTemplateRef('inputRef')

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    :class="cn(
      'flex items-center gap-2 border-t bg-sub px-4 py-3',
      props.class,
    )"
  >
    <span class="select-none text-muted-foreground font-mono">$</span>
    <input
      ref="inputRef"
      :value="input"
      :disabled="props.disabled"
      :placeholder="props.placeholder"
      :autofocus="props.autofocus"
      data-slot="serial-terminal-input"
      class="flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      @input="(e) => { input = (e.target as HTMLInputElement).value }"
      @keydown="onKeyDown"
    >

    <slot>
      <SerialTerminalNewLineToggle
        v-model="newLine"
      />
    </slot>

    <button
      class="rounded p-1 hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
      :disabled="props.disabled || !input.trim()"
      title="Send"
      @click="handleSend"
    >
      <ArrowRightIcon class="size-3.5" />
    </button>
  </div>
</template>
