---
title: SerialTerminal
description: A terminal-like component for serial input and output with a bounded output buffer.
contributors: ['myshkouski']
---

## What is Serial Terminal

Serial Terminal is a pure HTML terminal-like component for serial port input and output. Output is kept as the bytes the device sent, as a list of lines bounded by byte count: once the buffer exceeds `maxBytes` the oldest lines are dropped, and a line that grows past `maxLineBytes` keeps its first bytes and truncates the rest. Both limits are applied on write, so a fast or noisy device cannot grow the buffer without bound.

Every line is turned into the text it renders while it is written, and never rewritten afterwards: rendering a line is reading a string, not decoding data again, and switching the encoder applies to the lines written next and leaves the ones on screen untouched.

::component-preview{path=/registry/examples/SerialTerminal.vue}
::

## Installation

```bash
npx shadcn-vue@latest add https://extended.shadcn-vue.com/r/serial-terminal.json
```

## Usage

```vue
<script setup lang="ts">
import { decodeText, useTerminalOutput } from '@/registry/ui/serial-terminal'

const { entries, append, clear, truncatedBytes } = useTerminalOutput({
  maxBytes: 8 * 1024,
  maxLineBytes: 1024,
  // `decodeHex` for a binary device, `decodeText` for a text one
  encode: decodeText,
})

function onRead(chunk: Uint8Array) {
  append(chunk, 'output')
}
</script>
```

## API

::auto-type-table{path=/registry/ui/serial-terminal/SerialTerminal.vue}
::

### useTerminalOutput options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialEntries` | `Iterable<TerminalLineSeed>` | `[]` | Lines the buffer starts with, each a `type` and a `content` of bytes or text |
| `maxBytes` | `number` | `262144` | Maximum amount of content bytes kept in the buffer; oldest lines are dropped first |
| `maxLineBytes` | `number` | `1024` | Maximum amount of content bytes a single line can hold; extra bytes are dropped from the end of the line |
| `encode` | `MaybeRef<TerminalLineEncoder>` | `decodeText` | How bytes become the text a line renders, and how they are grouped into lines. A ref, so a plain value is read rather than called as a getter |
| `onTruncate` | `(bytes: number) => void` | — | Called with the amount of bytes dropped from the buffer |

Both limits are applied on write, so the amount of data kept in memory is
`max(maxBytes, maxLineBytes)` at worst. `truncatedBytes` is reset by `clear()`.

### Encoders

An encoder is a plain value, so a whole terminal can be switched between text and binary by handing `encode` a different one:

```ts
const encoder = computed(() => deviceIsBinary.value ? decodeHex : decodeText)
useTerminalOutput({ encode: encoder })
```

| Encoder | Lines | Line text |
|---------|-------|-----------|
| `decodeText` | Split on the `\n`, `\r\n` and lone `\r` bytes in the data | The bytes as UTF-8 |
| `decodeHex` | A fixed `lineBytes` amount of bytes per line, rendered once the line is full | Hex pairs, read through a `DataView` over the chunk they came from |

A text line keeps the break that ended it in `content`, so concatenating the lines gives the stream back, which is what copying the output does; the line component leaves that break out of what it displays. A binary line is never cut at a byte that happens to look like a line break, and the bytes of a line that has not filled up yet are held back and counted against `maxBytes` — if the encoder changes before they do, they are dropped, since the next encoder would group them differently.

Both are plain values, so `{ ...decodeHex, lineBytes: 8 }` or `{ kind: 'text', encode: bytes => bytes.join(' ') }` is a valid encoder too. A `kind: 'binary'` encoder receives a `DataView` over the incoming chunk as its second argument, so a hex dump needs no copy of the data.

Since a line is rendered as it is written, a character whose bytes have not all arrived yet renders as the replacement character, and is not corrected by the bytes that complete it later.

### Returned members

| Member | Type | Description |
|--------|------|-------------|
| `entries` | `Ref<Iterable<TerminalLineEntry>>` | Lines in the buffer, oldest first |
| `sizeBytes` | `Ref<number>` | Amount of content bytes currently kept in the buffer, including the bytes of a binary line that is not full yet |
| `truncatedBytes` | `Ref<number>` | Amount of content bytes dropped since the last `clear()` |
| `append(data, type)` | `(data: Uint8Array \| string, type: 'input' \| 'output' \| 'system') => void` | Appends data, grouping it into lines the way the encoder does. Text is encoded into bytes first, and content that starts without a break continues the last line |
| `clear()` | `() => void` | Removes all lines and resets `sizeBytes` and `truncatedBytes` |

A `TerminalLineEntry` holds the `bytes` it received as views over the incoming chunks, the `content` it renders as, its `type`, and the `byteLength` and `droppedBytes` it was accounted.

### SerialTerminal props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `class` | `string` | — | Additional CSS classes |

### SerialTerminalInput emits

| Event | Payload | Description |
|-------|---------|-------------|
| `send` | `string` | Emitted with the content to write to the device, including the line break picked in the newline toggle |