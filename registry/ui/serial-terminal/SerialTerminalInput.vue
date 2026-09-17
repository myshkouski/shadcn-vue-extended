<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '~/lib/utils';
import { ArrowRightIcon } from "@lucide/vue" 

export interface SerialTerminalInputProps {
  class?: HTMLAttributes["class"];
  disabled?: boolean;
  placeholder?: string;
  autofocus?: boolean;
}

export interface SerialTerminalInputEmits {
  (type: 'send', value: string): void
}

const props = defineProps<SerialTerminalInputProps>()
const emit = defineEmits<SerialTerminalInputEmits>()

const input = ref('')

function handleSend() {
  let value = input.value
  if (newLine.value) {
    value += newLine.value
  }
  emit('send', value)
  input.value = ''
}

function onKeyDown(e: KeyboardEvent) {
  const key = e.key.toLowerCase()
  if (key === 'enter') {
    e.preventDefault()
    handleSend()
  }

  if (key === 'backspace' && e.ctrlKey && !props.disabled) {
    e.preventDefault()
    input.value = ''
  }
}

const inputRef = useTemplateRef("inputRef")

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })

const newLineOptions = ['', '\n', '\r\n'] as const
const newLine = ref<typeof newLineOptions[number]>(newLineOptions[0])
function switchNewLine() {
  const index = newLineOptions.indexOf(newLine.value)
  newLine.value = newLineOptions[(index + 1) % newLineOptions.length]!
}

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
    <button
      :class="[
        'shrink-0 rounded p-1 hover:bg-accent focus-visible:bg-accent disabled:opacity-50',
        
      ]"
      title="Newline"
      @click="switchNewLine"
    >
      <!-- <TextWrapIcon class="size-3.5" /> -->
      
      <span v-for="(char, index) in ['CR', 'LF']" 
        :class="['font-mono text-xs', { 'text-primary': newLineOptions.indexOf(newLine) > index }]">{{ char }}</span>
    </button>
    <button
      class="shrink-0 rounded p-1 hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
      :disabled="props.disabled || !input.trim()"
      title="Send"
      @click="handleSend"
    >
      <ArrowRightIcon class="size-3.5" />
    </button>
  </div>

</template>