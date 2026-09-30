<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

export interface SerialTerminalNewLineToggleProps {
  class?: HTMLAttributes['class']
  disabled?: boolean
}

export type SerialTerminalNewLineToggleModelValue = '' | '\n' | '\r\n'

const props = defineProps<SerialTerminalNewLineToggleProps>()

const newLineOptions = ['', '\n', '\r\n'] as const satisfies SerialTerminalNewLineToggleModelValue[]

const newLine = defineModel<SerialTerminalNewLineToggleModelValue>({
  default: '',
})

function switchNewLine() {
  const index = newLineOptions.indexOf(newLine.value)
  newLine.value = newLineOptions[(index + 1) % newLineOptions.length]!
}

const chars = [
  { char: '\r', text: 'CR' },
  { char: '\n', text: 'LF' },
] as const
</script>

<template>
  <button
    type="button"
    :class="cn([
      'rounded px-1 hover:bg-accent focus-visible:bg-accent disabled:opacity-50',
      props.class,
    ])"
    :disabled="props.disabled"
    @click="switchNewLine"
  >
    <span
      v-for="{ char, text } in chars"
      :key="char"
      class="font-mono text-xs transition-[color,opacity]"
      :class="[
        newLine.includes(char) ? 'text-primary font-bold' : 'opacity-50',
      ]"
    >
      {{ text }}
    </span>
  </button>
</template>
