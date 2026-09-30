---
title: SerialTerminal
description: A terminal-like component for serial input and output with a bounded output buffer.
contributors: ['myshkouski']
---

## What is Serial Terminal

Serial Terminal is a pure HTML terminal-like component for serial port input and output. Output is stored as a list of lines and bounded by bytes: once the buffer exceeds `maxBytes` the oldest lines are dropped, and a line that grows past `maxLineBytes` keeps its first bytes and truncates the rest. Both limits are applied on write, so a fast or noisy device cannot grow the buffer without bound.

::component-preview{path=/registry/examples/SerialTerminal.vue}
::

## Installation

```bash
npx shadcn-vue@latest add https://extended.shadcn-vue.com/r/serial-terminal.json
```

## Usage

```vue
<script setup lang="ts">
import { useTerminalOutput } from '@/registry/ui/serial-terminal'

const { entries, append, clear, truncatedBytes } = useTerminalOutput({
  maxBytes: 8 * 1024,
  maxLineBytes: 1024,
})
</script>
```

## API

::auto-type-table{path=/registry/ui/serial-terminal/SerialTerminal.vue}
::

### useTerminalOutput options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialEntries` | `Iterable<TerminalLineEntry>` | `[]` | Lines the buffer starts with |
| `maxBytes` | `number` | `262144` | Maximum amount of content bytes kept in the buffer; oldest lines are dropped first |
| `maxLineBytes` | `number` | `1024` | Maximum amount of content bytes a single line can hold; extra bytes are dropped from the end of the line |
| `onTruncate` | `(bytes: number) => void` | — | Called with the amount of bytes dropped from the buffer |

Both limits are applied on write, so the amount of data kept in memory is
`max(maxBytes, maxLineBytes)` at worst. `truncatedBytes` is reset by `clear()`.

### Exposed methods

| Method | Description |
|--------|-------------|
| `write(content, type?)` | Write content to the terminal; returns the entry ID; content is stored as-is with no newline appended — a visual line break only occurs if the content ends with `\n`. Auto-removes oldest lines if over `maxBytes` |
| `append(id, content)` | Append content to an existing entry by key |
| `removeEntry(id)` | Remove a specific entry by its unique key |
| `removeOldest(count?)` | Remove N oldest entries (default 1) |
| `clear()` | Remove all entries and emit `clear` |
| `focus()` | Focus the input field |
| `getEntries()` | Returns the underlying `Map<string, SerialEntry>` |

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `class` | `string` | — | Additional CSS classes |
| `modelValue` | `string` | `''` | Bound input value (v-model) |
| `placeholder` | `string` | `'Type a command and press Enter...'` | Input placeholder |
| `disabled` | `boolean` | `false` | Disable input |
| `autofocus` | `boolean` | `false` | Auto-focus the input |

### Emits

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `string` | Emitted when input value changes |
| `send` | `{ id: string; content: string }` | Emitted when user presses Enter |
| `clear` | — | Emitted when terminal is cleared |
