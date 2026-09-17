---
title: Serial Terminal
description: A terminal-like component for serial input and output with configurable max entries.
contributors: ['myshkouski']
---

## What is Serial Terminal

Serial Terminal is a pure HTML terminal-like component for serial port input and output. It tracks entries internally using a `Map<string, SerialEntry>` keyed by unique IDs, and automatically removes the oldest entries when the configured limit is exceeded.

::component-preview{path=/registry/examples/SerialTerminal.vue}
::

## Installation

```bash
npx shadcn-vue@latest add https://extended.shadcn-vue.com/r/serial-terminal.json
```

## Usage

```vue
<script setup lang="ts">
import { SerialTerminal } from '@/registry/ui/serial-terminal'
</script>

<template>
  <SerialTerminal
    v-model="input"
    :max-entries="200"
    @send="({ content }) => {
      // handle serial send
    }"
  />
</template>
```

## API

::auto-type-table{path=/registry/ui/serial-terminal/SerialTerminal.vue}
::

### Exposed methods

| Method | Description |
|--------|-------------|
| `write(content, type?)` | Write content to the terminal; returns the entry ID; content is stored as-is with no newline appended — a visual line break only occurs if the content ends with `\n`. Auto-removes oldest if over limit |
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
| `maxEntries` | `number` | `200` | Maximum entries before oldest are removed |
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
