import type { MaybeRefOrGetter, Ref } from 'vue'
import { computed, readonly, ref, toValue, watchEffect } from 'vue'

export interface UseTerminalOutputOptions {
  initialEntries?: MaybeRefOrGetter<Iterable<TerminalLineEntry>>
  maxEntries?: MaybeRefOrGetter<number>
  onTruncate?: (entries: Iterable<TerminalLineEntry>) => void
}

export interface UseTerminalOutputReturn {
  entries: Readonly<Ref<readonly TerminalLineEntry[]>>
  append: (content: string, type: TerminalLineEntryType) => void
  clear: () => void
}

export function useTerminalOutput(options?: UseTerminalOutputOptions): UseTerminalOutputReturn {
  const initialEntriesValue = toValue(options?.initialEntries)
  const entries = ref<TerminalLineEntry[]>(initialEntriesValue ? [...initialEntriesValue] : [])

  const maxEntries = computed(() => toValue(options?.maxEntries) ?? Number.MAX_SAFE_INTEGER)

  const onTruncate = options?.onTruncate

  watchEffect(() => {
    if (entries.value.length > maxEntries.value) {
      const truncatedEntries = entries.value.splice(0, entries.value.length - maxEntries.value)
      onTruncate?.(truncatedEntries)
    }
  })

  return {
    entries: readonly(entries),
    append: append.bind(globalThis, entries),
    clear: () => { entries.value = [] },
  }
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

function append(
  entries: Ref<TerminalLineEntry[]>,
  content: string,
  type: TerminalLineEntryType,
) {
  const lines = content.split(/\r?\n/)

  if (!lines.length)
    return

  let linesIndex = 0
  const entriesIndex = Math.max(0, entries.value.length - 1)

  if (entries.value.length > 0) {
    const lastLine = entries.value[entriesIndex]!
    entries.value[entriesIndex] = new DefaultTerminalLineEntry(
      lastLine.type,
      lastLine!.content + lines[0]!,
    )
    linesIndex++
  }

  while (linesIndex < lines.length) {
    entries.value[linesIndex + entriesIndex] = new DefaultTerminalLineEntry(
      type,
      lines[linesIndex]!,
    )

    linesIndex++
  }
}

export type TerminalLineEntryType = 'input' | 'output' | 'system'

export interface TerminalLineEntry {
  readonly id: string
  readonly content: string
  readonly type: TerminalLineEntryType
}

class DefaultTerminalLineEntry implements TerminalLineEntry {
  readonly id = createId()

  constructor(
    readonly type: TerminalLineEntryType,
    readonly content: string,
  ) {}
}
