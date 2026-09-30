import type { MaybeRefOrGetter, Ref } from 'vue'
import { computed, readonly, ref, shallowRef, toRaw, toValue } from 'vue'

const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_LINE_BYTES = 1024
const PENDING_CHUNKS_LIMIT = 16

export interface UseTerminalOutputOptions {
  initialEntries?: MaybeRefOrGetter<Iterable<TerminalLineEntry>>
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
  onTruncate?: (bytes: number | bigint) => void
}

export interface UseTerminalOutputReturn {
  entries: Readonly<Ref<Iterable<TerminalLineEntry>>>
  /**
   * Amount of content bytes currently kept in the buffer.
   */
  sizeBytes: Readonly<Ref<number | bigint>>
  /**
   * Amount of content bytes dropped since the last `clear()` call.
   */
  truncatedBytes: Readonly<Ref<number | bigint>>
  append: (content: string, type: TerminalLineEntryType) => void
  clear: () => void
}

export type TerminalLineEntryType = 'input' | 'output' | 'system'

export interface TerminalLineEntry {
  readonly id: string
  readonly content: string
  readonly type: TerminalLineEntryType
  /**
   * Amount of content bytes kept for this line.
   */
  readonly byteLength?: number | bigint
  /**
   * Amount of content bytes dropped from the end of this line.
   */
  readonly droppedBytes?: number | bigint
}

/**
 * Mutable counterpart of {@link TerminalLineEntry}. Lines are plain objects on
 * purpose, so that deep watchers and render effects pick up in-place `content`
 * updates. Bookkeeping that should never be observed by the UI lives outside of
 * the object in a `WeakMap`, keeping the line itself cheap to track.
 */
interface TerminalLineState {
  id: string
  type: TerminalLineEntryType
  content: string
  byteLength: number | bigint
  droppedBytes: number | bigint
}

const pendingChunks = new WeakMap<TerminalLineState, string[]>()

export function useTerminalOutput(options?: UseTerminalOutputOptions): UseTerminalOutputReturn {
  const entries = ref<TerminalLineEntry[]>([])
  const sizeBytes = shallowRef<number | bigint>(0)
  const truncatedBytes = shallowRef<number | bigint>(0)

  const maxBytes = computed(() => Math.max(0, toValue(options?.maxBytes) ?? DEFAULT_MAX_BYTES))
  const maxLineBytes = computed(() => Math.max(0, toValue(options?.maxLineBytes) ?? DEFAULT_MAX_LINE_BYTES))
  const onTruncate = options?.onTruncate

  // Written content is buffered as chunks and joined once per microtask, so a
  // high frequency source (`pull()` firing per byte) never rebuilds a string per
  // byte. `content` stays a plain tracked property, which is what keeps
  // re-renders and deep watchers working.
  const pendingLines = new Set<TerminalLineEntry>()
  let isFlushScheduled = false

  function scheduleFlush() {
    if (isFlushScheduled)
      return
    isFlushScheduled = true
    queueMicrotask(() => {
      isFlushScheduled = false
      flush()
    })
  }

  function flush() {
    for (const entry of pendingLines) {
      const chunks = pendingChunks.get(toRaw(entry) as TerminalLineState)
      if (chunks?.length) {
        const line = asState(entry)
        line.content = line.content + chunks.join('')
        chunks.length = 0
      }
    }
    pendingLines.clear()
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
    return 'bigint' == typeof value
  }

  /**
   * Fits `content` into the remaining room of `line` and accounts for it.
   * Returns the part of `content` that made it into the buffer.
   */
  function reserve(line: TerminalLineState, content: string): string | undefined {
    if (!content)
      return

    let available = differenceOf(maxLineBytes.value, line.byteLength)
    if (available > Number.MAX_SAFE_INTEGER) {
      available = Number.MAX_SAFE_INTEGER
    } else {
      available = Number(available)
    }

    if (available <= 0) {
      // The line is already at its limit: its first bytes are the ones being
      // kept and everything written after them is dropped.
      drop(line, content.length)
      return
    }

    const kept = content.length > available ? content.slice(0, available) : content

    line.byteLength = sumOf(line.byteLength, kept.length)
    sizeBytes.value = sumOf(sizeBytes.value, kept.length)
    drop(line, content.length - kept.length)

    return kept
  }

  function write(entry: TerminalLineEntry, content: string) {
    const kept = reserve(asState(entry), content)
    if (!kept)
      return

    const key = toRaw(entry) as TerminalLineState
    let chunks = pendingChunks.get(key)

    if (!chunks) {
      chunks = []
      pendingChunks.set(key, chunks)
    }

    chunks.push(kept)
    if (chunks.length > PENDING_CHUNKS_LIMIT) {
      const merged = chunks.join('')
      chunks.length = 0
      chunks.push(merged)
    }

    pendingLines.add(entry)
    scheduleFlush()
  }

  function createLine(type: TerminalLineEntryType, content: string): TerminalLineState {
    const line: TerminalLineState = {
      id: createId(),
      type,
      content: '',
      byteLength: 0,
      droppedBytes: 0,
    }
    line.content = reserve(line, content) ?? ''
    return line
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
      pendingLines.delete(entry)
      sizeBytes.value = differenceOf(sizeBytes.value, line.byteLength)
      drop(line, line.byteLength)
    }
  }

  function append(content: string, type: TerminalLineEntryType) {
    if (!content)
      return

    const list = entries.value
    const lines = content.split(/\r?\n/)

    let index = 0

    if (list.length > 0) {
      write(list[list.length - 1]!, lines[0]!)
      index++
    }

    while (index < lines.length) {
      list.push(createLine(type, lines[index]!))
      index++
    }

    evict()
  }

  function clear() {
    pendingLines.clear()
    entries.value = []
    sizeBytes.value = 0
    truncatedBytes.value = 0
  }

  const initialEntries = toValue(options?.initialEntries)

  if (initialEntries) {
    for (const entry of initialEntries) {
      entries.value.push(createLine(entry.type, entry.content))
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
