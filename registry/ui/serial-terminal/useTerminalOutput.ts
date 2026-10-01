import type { MaybeRef, MaybeRefOrGetter, Ref } from 'vue'
import type { TerminalLineEncoder } from './encoders'
import { computed, readonly, ref, shallowRef, toValue, unref } from 'vue'
import { decodeHex, decodeText, DEFAULT_BINARY_LINE_BYTES } from './encoders'

const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_LINE_BYTES = 1024

const CARRIAGE_RETURN = 0x0D
const LINE_FEED = 0x0A

const EMPTY_BYTES = new Uint8Array(0)

const textEncoder = new TextEncoder()

export interface UseTerminalOutputOptions {
  initialEntries?: MaybeRefOrGetter<Iterable<TerminalLineSeed>>
  /**
   * Maximum amount of content bytes kept in the buffer at once.
   * Oldest lines are dropped first once the limit is exceeded.
   */
  maxBytes?: MaybeRefOrGetter<number>
  /**
   * Maximum amount of content bytes a single line is allowed to hold.
   * Bytes written past that limit are dropped from the end of the line.
   */
  maxLineBytes?: MaybeRefOrGetter<number>
  /**
   * How bytes become the text a line renders, and how they are grouped into
   * lines in the first place. Defaults to {@link decodeText}.
   *
   * A ref rather than a getter: the encoder is itself a value, which `toValue()`
   * would call instead of reading.
   */
  encode?: MaybeRef<TerminalLineEncoder>
  onTruncate?: (bytes: number | bigint) => void
}

export interface UseTerminalOutputReturn {
  entries: Readonly<Ref<Iterable<TerminalLineEntry>>>
  /**
   * Amount of content bytes currently kept in the buffer, including the bytes
   * of a binary line that has not been rendered yet.
   */
  sizeBytes: Readonly<Ref<number | bigint>>
  /**
   * Amount of content bytes dropped since the last `clear()` call.
   */
  truncatedBytes: Readonly<Ref<number | bigint>>
  /**
   * Appends `data` to the buffer, grouped into lines by the active encoder.
   * Text is encoded into bytes first, so lines the terminal itself produces
   * share the buffer with device output.
   */
  append: (data: Uint8Array | string, type: TerminalLineEntryType) => void
  clear: () => void
}

export type TerminalLineEntryType = 'input' | 'output' | 'system'

/**
 * A line the buffer starts with, rendered as a single line whatever the active
 * encoder does with a stream.
 */
export interface TerminalLineSeed {
  readonly type: TerminalLineEntryType
  readonly content?: Uint8Array | string
}

export interface TerminalLineEntry {
  readonly id: string
  readonly type: TerminalLineEntryType
  /**
   * Bytes of this line, as they were received: views over the incoming chunks
   * rather than copies of them.
   */
  readonly bytes: Uint8Array
  /**
   * Text of this line, written once and never rewritten.
   *
   * A text line keeps the break that ended it, so concatenating the lines of
   * the buffer gives the stream back, which is what copying the output uses.
   */
  readonly content: string
  /**
   * Amount of content bytes kept for this line.
   */
  readonly byteLength?: number | bigint
  /**
   * Amount of content bytes dropped from the end of this line.
   */
  readonly droppedBytes?: number | bigint
}

interface TerminalLineState {
  id: string
  type: TerminalLineEntryType
  bytes: Uint8Array
  content: string
  byteLength: number | bigint
  droppedBytes: number | bigint
}

/**
 * Half-open slice of a chunk holding one line, break included, plus the index
 * the next line starts at.
 */
interface LineSegment {
  start: number
  end: number
  next: number
}

export function useTerminalOutput(options?: UseTerminalOutputOptions): UseTerminalOutputReturn {
  const entries = ref<TerminalLineEntry[]>([])
  const sizeBytes = shallowRef<number | bigint>(0)
  const truncatedBytes = shallowRef<number | bigint>(0)

  const maxBytes = computed(() => Math.max(0, toValue(options?.maxBytes) ?? DEFAULT_MAX_BYTES))
  const maxLineBytes = computed(() => Math.max(0, toValue(options?.maxLineBytes) ?? DEFAULT_MAX_LINE_BYTES))
  const onTruncate = options?.onTruncate

  // The encoder is read on write, never on read: a line is rendered as it is
  // written and stays as it is, so switching the encoder changes what the lines
  // written next look like and leaves the ones on screen untouched.
  let encoding: TerminalLineEncoder = unref(options?.encode) ?? decodeText

  // Bytes of the binary line currently being filled in. They are accounted for
  // from the moment they arrive, but a binary line is only rendered once it
  // holds its full length.
  let pending: Uint8Array = EMPTY_BYTES

  function render(bytes: Uint8Array): string {
    if (encoding.kind === 'binary') {
      const encode = encoding.encode ?? decodeHex.encode!

      // A view over the chunk the line was written from, so rendering a hex
      // dump needs no copy of the data.
      return encode(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    }

    const encode = encoding.encode ?? decodeText.encode!

    return encode(bytes)
  }

  /**
   * Bytes a rendered binary line holds, for a binary encoder.
   *
   * Never longer than `maxLineBytes`, so a full line always fits the buffer and
   * none of its bytes count as dropped.
   */
  function binaryLineBytes(): number {
    if (encoding.kind !== 'binary')
      return maxLineBytes.value

    const lineBytes = encoding.lineBytes ?? DEFAULT_BINARY_LINE_BYTES

    return Math.max(1, Math.min(lineBytes, maxLineBytes.value))
  }

  function drop(line: TerminalLineState, bytes: number | bigint) {
    if (bytes <= 0)
      return
    line.droppedBytes = sumOf(line.droppedBytes, bytes)
    truncatedBytes.value = sumOf(truncatedBytes.value, bytes)
    onTruncate?.(bytes)
  }

  function sumOf(value: number | bigint, other: number | bigint): number | bigint {
    if (isBigint(value) || isBigint(other)) {
      return BigInt(value) + BigInt(other)
    }
    return value + other
  }

  function differenceOf(value: number | bigint, other: number | bigint): number | bigint {
    if (isBigint(value) || isBigint(other)) {
      return BigInt(value) - BigInt(other)
    }
    return value - other
  }

  function isBigint(value: number | bigint): value is bigint {
    return typeof value === 'bigint'
  }

  /**
   * Fits `segment` into the room left on `line` and accounts for it. Returns the
   * part of the segment that made it into the buffer.
   */
  function reserve(line: TerminalLineState, bytes: Uint8Array, segment: LineSegment): Uint8Array | undefined {
    const length = segment.end - segment.start
    if (length <= 0)
      return

    let available = differenceOf(maxLineBytes.value, line.byteLength)
    if (available > Number.MAX_SAFE_INTEGER) {
      available = Number.MAX_SAFE_INTEGER
    }
    else {
      available = Number(available)
    }

    if (available <= 0) {
      // The line is already at its limit: its first bytes are the ones being
      // kept and everything written after them is dropped.
      drop(line, length)
      return
    }

    const keptLength = Math.min(length, available)

    line.byteLength = sumOf(line.byteLength, keptLength)
    sizeBytes.value = sumOf(sizeBytes.value, keptLength)
    drop(line, length - keptLength)

    return bytes.subarray(segment.start, segment.start + keptLength)
  }

  function createLine(type: TerminalLineEntryType, bytes: Uint8Array, segment: LineSegment): TerminalLineState {
    const line: TerminalLineState = {
      id: createId(),
      type,
      bytes: EMPTY_BYTES,
      content: '',
      byteLength: 0,
      droppedBytes: 0,
    }

    const kept = reserve(line, bytes, segment)

    if (kept) {
      line.bytes = kept
      line.content = render(kept)
    }

    return line
  }

  function writeText(entry: TerminalLineEntry, bytes: Uint8Array, segment: LineSegment) {
    const line = asState(entry)
    const kept = reserve(line, bytes, segment)
    if (!kept)
      return

    line.content += render(kept)
    line.bytes = merge(line.bytes, kept)
  }

  function appendText(bytes: Uint8Array, type: TerminalLineEntryType) {
    const list = entries.value
    let index = 0

    // Content that does not start with a line break continues the last line,
    // which is what makes a device writing without a trailing newline still
    // fill the line it is on.
    if (list.length > 0) {
      const segment = readSegment(bytes, 0)
      writeText(list[list.length - 1]!, bytes, segment)
      index = segment.next
    }

    while (index < bytes.length) {
      const segment = readSegment(bytes, index)
      list.push(createLine(type, bytes, segment))
      index = segment.next
    }

    evict()
  }

  function appendBinary(bytes: Uint8Array, type: TerminalLineEntryType) {
    const list = entries.value
    const lineBytes = binaryLineBytes()
    let line: Uint8Array = pending
    let index = 0

    // Counted as they arrive: these bytes are held by the buffer whether they
    // fill a line now or the next one.
    sizeBytes.value = sumOf(sizeBytes.value, bytes.length)

    while (index < bytes.length) {
      const kept = Math.min(lineBytes - line.length, bytes.length - index)
      line = merge(line, bytes.subarray(index, index + kept))
      index += kept

      // A line is rendered once it overflows, and only then.
      if (line.length < lineBytes)
        break

      list.push({
        id: createId(),
        type,
        bytes: line,
        content: render(line),
        byteLength: line.length,
        droppedBytes: 0,
      })

      line = EMPTY_BYTES
    }

    pending = line

    evict()
  }

  function dropPending() {
    if (!pending.length)
      return

    // The bytes of a line that was never rendered would be split by the next
    // encoder differently than the binary one did, so they cannot be kept.
    truncatedBytes.value = sumOf(truncatedBytes.value, pending.length)
    sizeBytes.value = differenceOf(sizeBytes.value, pending.length)
    onTruncate?.(pending.length)
    pending = EMPTY_BYTES
  }

  function evict() {
    const list = entries.value
    const limit = maxBytes.value

    // The line currently being written to is always kept, `maxLineBytes` is the
    // hard ceiling for it.
    if (sizeBytes.value <= limit || list.length <= 1)
      return

    let count = 0
    let remaining: number | bigint = sizeBytes.value

    while (count < list.length - 1 && remaining > limit) {
      remaining = differenceOf(remaining, asState(list[count]!).byteLength)
      count++
    }

    for (const entry of list.splice(0, count)) {
      const line = asState(entry)
      sizeBytes.value = differenceOf(sizeBytes.value, line.byteLength)
      drop(line, line.byteLength)
    }
  }

  function append(data: Uint8Array | string, type: TerminalLineEntryType) {
    const bytes = toBytes(data)
    if (!bytes.length)
      return

    const next = unref(options?.encode) ?? decodeText

    if (next !== encoding) {
      encoding = next
      dropPending()
    }

    if (encoding.kind === 'binary')
      appendBinary(bytes, type)
    else
      appendText(bytes, type)
  }

  function clear() {
    pending = EMPTY_BYTES
    entries.value = []
    sizeBytes.value = 0
    truncatedBytes.value = 0
  }

  const initialEntries = toValue(options?.initialEntries)

  if (initialEntries) {
    for (const entry of initialEntries) {
      const bytes = toBytes(entry.content)
      const segment = { start: 0, end: bytes.length, next: bytes.length }
      entries.value.push(createLine(entry.type, bytes, segment))
    }
    evict()
  }

  return {
    entries: readonly(entries),
    sizeBytes: readonly(sizeBytes),
    truncatedBytes: readonly(truncatedBytes),
    append,
    clear,
  }
}

/**
 * Locates the line starting at `from`: the bytes up to and including the next
 * line break, and where the following line starts.
 *
 * `\r\n` counts as a single break and a lone `\r` ends a line on its own, the
 * way a terminal treats the input it receives. Only `\r` and `\n` can split a
 * line, and neither is a byte of a multi-byte UTF-8 sequence, so a line is
 * always cut between characters.
 */
function readSegment(bytes: Uint8Array, from: number): LineSegment {
  for (let index = from; index < bytes.length; index++) {
    const byte = bytes[index]!

    if (byte === LINE_FEED)
      return { start: from, end: index + 1, next: index + 1 }

    if (byte === CARRIAGE_RETURN) {
      const next = bytes[index + 1] === LINE_FEED ? index + 2 : index + 1

      return { start: from, end: next, next }
    }
  }

  return { start: from, end: bytes.length, next: bytes.length }
}

function toBytes(data: Uint8Array | string | undefined): Uint8Array {
  if (typeof data === 'string')
    return textEncoder.encode(data)

  return data ?? EMPTY_BYTES
}

/**
 * Concatenates `chunk` onto `base`, reusing either side when there is nothing
 * to merge.
 */
function merge(base: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (!base.length)
    return chunk

  if (!chunk.length)
    return base

  const merged = new Uint8Array(base.length + chunk.length)
  merged.set(base, 0)
  merged.set(chunk, base.length)

  return merged
}

function asState(entry: TerminalLineEntry): TerminalLineState {
  return entry as unknown as TerminalLineState
}

function createTimestampId(exponent: number = 0) {
  const now = Date.now()
  const div = 10 ** exponent
  const timestamp = div > 1
    ? Math.floor(now / div) * div
    : now
  return timestamp.toString(36)
}

function createRandomId() {
  return Math.random().toString(36).slice(2)
}

function createId(): string {
  return `${createTimestampId()}-${createRandomId()}`
}
