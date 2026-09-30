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
    try {
      await writer.value?.write(chunk)
    }
    catch (cause) {
      const e = cause instanceof Error
        ? cause
        : new Error('Unable to write', { cause })

      error.value = e

      throw e
    }
  }

  function start() {
    writer.value = toValue(writable)?.getWriter()
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
