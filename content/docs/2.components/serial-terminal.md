---
title: SerialTerminal
description: A terminal-like component for serial input and output with a bounded output buffer.
contributors: ['myshkouski']
---

## What is Serial Terminal

Serial Terminal is a pure HTML terminal-like component for serial port input and output. Output is kept as the bytes the device sent, as a list of lines bounded by byte count: once the buffer exceeds `maxBytes` the oldest lines are dropped, and a line that grows past `maxLineBytes` keeps its first bytes and truncates the rest. Both limits are applied on write, so a fast or noisy device cannot grow the buffer without bound.

Every line is turned into the text it renders while it is written, and never rewritten afterwards: rendering a line is reading a string, not decoding data again, and switching the encoder applies to the lines written next and leaves the ones on screen untouched.

Every line but the last is frozen as it seals, and the buffer publishes a new list only when a line is added or evicted. A write that only grows the line being written to costs no list at all: that line is reactive, so its own row repaints while every other row is handed the object it already has and skipped.

Writes are paced by the reader rather than by the buffer: `useTerminalReader` reads a slice and hands the main thread back between slices, so a device that writes as fast as the event loop turns costs one write per chunk it read rather than a stall.

::component-preview{path=/registry/blocks/serial-terminal/SerialTerminal.vue}
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
| `onTruncate` | `(bytes: number \| bigint) => void` | — | Called once per burst of dropped bytes with the amount dropped from the buffer |

Both limits are applied on write, so the amount of data kept in memory is
`max(maxBytes, maxLineBytes)` at worst. `truncatedBytes` is reset by `clear()`.

Pacing is not an option of the buffer: writes reach it as they are
appended, and it is the reader that bounds how fast a device may
write. See [Reading](#reading).

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
| `entries` | `Ref<readonly TerminalLineEntry[]>` | The lines of the buffer, oldest first. Every line but the last is sealed: frozen and never rewritten, so the ref only changes when a line was added or evicted. The last element, when a text line is open, is that line — reactive, and the only entry whose content changes |
| `sizeBytes` | `Ref<number>` | Amount of content bytes currently kept in the buffer, including the bytes of a binary line that is not full yet |
| `truncatedBytes` | `Ref<number \| bigint>` | Amount of content bytes dropped since the last `clear()`. A `number` until it passes `Number.MAX_SAFE_INTEGER`, a `bigint` past it |
| `append(data, type)` | `(data: Uint8Array \| string, type: 'input' \| 'output' \| 'system') => void` | Appends data, grouping it into lines the way the encoder does, and writes it through: the lines are in the buffer by the time it returns. Text is encoded into bytes first, and content that starts without a break continues the open line |
| `clear()` | `() => void` | Removes all lines and resets `sizeBytes` and `truncatedBytes` |

A `TerminalLineEntry` holds the `bytes` it was written from as one
concatenation — a sealed entry materialises it once, when the line
seals — the `content` it renders as, its `type`, and the `byteLength`
and `droppedBytes` it was accounted.

The split between cold and hot is inside the one list. A sealed line
never changes, so it is frozen and keeps its identity for as long as it
is on screen; the line still being written to is the last element, and
is reactive. Render `entries` as the list it is, as the example does: a
write that only grows the open line then costs one row rather than a
walk over every line on screen, and the whole stream — the open line
included — is in `entries`, which is what copying the output reads.

### Reading

`useSerialTerminal` (and the `useTerminalReader` it is built on) reads a stream
in a loop, and a source with no pacing of its own resolves every read on a
microtask: a loop made of those never reaches the task queue at all, so nothing
renders, no timer fires and no click is handled — the page stops, rather than
slowing down. The reader therefore reads in slices and hands the main thread
back between them.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `throttle` | `'frame' \| 'idle' \| 'task' \| 'none'` | `'frame'` | How the read loop hands the main thread back while data keeps coming |
| `throttleInterval` | `number` | `16` | How long the loop reads before handing the main thread back, in milliseconds |

| Value | The loop yields |
|-------|-----------------|
| `frame` | On the next animation frame, or on a 100 ms timer where there is no frame — a tab that is not on screen is given none, and a serial port keeps sending while it is hidden |
| `idle` | On the next idle callback, asked for with a timeout so a busy page is still shown what was read. Idle time is handed out last, so this is for a terminal that should not compete with whatever else the page is doing |
| `task` | On a macrotask, which is enough to keep the page alive without waiting for a frame |
| `none` | Never, for a source that paces itself |

The reader is what paces a device that writes as fast as the event
loop turns: the buffer writes through, so a slice the loop reads costs
one write per chunk it read, and `maxBytes` is what bounds what those
writes add up to.

### SerialTerminal props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `class` | `string` | — | Additional CSS classes |

### SerialTerminalInput emits

| Event | Payload | Description |
|-------|---------|-------------|
| `send` | `string` | Emitted with the content to write to the device, including the line break picked in the newline toggle |

## Connecting a serial port

The serial terminal block (`registry/blocks/serial-terminal`) is this component with the wiring around it: a modal that lists the ports the browser already knows about, a baud rate to open one with, and a separate button that asks the browser for a device the app has never seen.

The dialog belongs to that block, not to this component, because it only decides what is picked. The WebSerial calls stay next to it, where the gesture that opens the browser picker is the click that asked for it: picking a port from the list opens nothing until the footer button runs, and opening a port twice throws, so a port that is already open is attached to rather than reopened.

The block is the one to install when the terminal has to talk to a real device:

```bash
npx shadcn-vue@latest add https://extended.shadcn-vue.com/r/serial-terminal-01.json
```

Every part is plain `registry:component` source, so the handlers that own the device are the ones to read before changing anything about how a port is opened.
