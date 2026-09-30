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
    // The previously attached writer is released by the `writer` watcher below,
    // so assigning here is all it takes to move over to the next target.
    try {
      writer.value = toValue(writable)?.getWriter()
    }
    catch (e) {
      error.value = e as Error
      throw e
    }
    error.value = void 0
  }

  function stop() {
    writer.value = void 0
  }

  tryOnScopeDispose(() => {
    stop()
  })

  watchImmediate(writer, (_, oldWriter) => {
    oldWriter?.releaseLock()
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
