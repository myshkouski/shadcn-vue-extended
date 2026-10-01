import type { MaybeRefOrGetter, Stoppable } from '@vueuse/core'
import type { Ref } from 'vue'
import { tryOnScopeDispose, watchImmediate } from '@vueuse/core'
import { computed, readonly, shallowRef, toValue } from 'vue'

export interface UseTerminalWriterOptions { }
export interface UseTerminalWriterReturn<T> extends Stoppable {
  write: (chunk: T) => Promise<void>
  error: Readonly<Ref<Error | null | undefined>>
}

export function useTerminalWriter<T>(
  writable: MaybeRefOrGetter<WritableStream<T> | null | undefined>,
): UseTerminalWriterReturn<T> {
  const writer = shallowRef<WritableStreamDefaultWriter<T>>()
  const error = shallowRef<Error>()
  const isPending = computed(() => {
    return !!writer.value
  })

  // A writer can be detached both here and by the watcher below, and
  // `releaseLock()` throws once a writer is no longer attached to its stream.
  const detachedWriters = new WeakSet<WritableStreamDefaultWriter<T>>()

  function detach(target: WritableStreamDefaultWriter<T> | undefined) {
    if (!target || detachedWriters.has(target))
      return

    detachedWriters.add(target)
    target.releaseLock()
  }

  async function write(chunk: T) {
    const current = writer.value

    if (!current)
      return

    try {
      await current.write(chunk)
    }
    catch (cause) {
      // A released writer (target switched mid-write) rejects the pending
      // write. That is teardown, not a failure of the target, so it neither
      // lands in `error` nor rejects into the caller. Closing the sink stays
      // the responsibility of the target itself.
      if (writer.value !== current)
        return

      const e = cause instanceof Error
        ? cause
        : new Error('Unable to write', { cause })

      error.value = e

      throw e
    }
  }

  function start() {
    // Released up front rather than left to the watcher below: whoever switched
    // targets may close the previous one as soon as this returns, and a locked
    // stream rejects `close()`.
    detach(writer.value)

    try {
      writer.value = toValue(writable)?.getWriter()
    }
    catch (e) {
      writer.value = void 0
      error.value = e as Error
      throw e
    }
    error.value = void 0
  }

  function stop() {
    // Detaches the writer and drops its lock right away, so the caller can tear
    // the target down without waiting for a flush. Closing the sink stays the
    // responsibility of the target itself.
    detach(writer.value)
    writer.value = void 0
  }

  tryOnScopeDispose(() => {
    stop()
  })

  watchImmediate(writer, (_, oldWriter) => {
    detach(oldWriter)
  })

  watchImmediate(() => toValue(writable), () => {
    start()
  })

  return {
    isPending,
    error: readonly(error),
    stop,
    start,
    write,
  }
}
