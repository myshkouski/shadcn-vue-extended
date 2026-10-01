import type { MaybeRefOrGetter, Stoppable } from '@vueuse/core'
import type { Ref } from 'vue'
import type { UseStreamLockReturn } from './useStreamLock'
import { watchImmediate } from '@vueuse/core'
import { readonly } from 'vue'
import { useStreamLock } from './useStreamLock'

export interface UseTerminalReaderOptions<T> {
  onRead?: (data: T) => Promise<void> | void
}

export interface UseTerminalReaderReturn extends Stoppable {
  isPending: Readonly<Ref<boolean>>
  error: Readonly<Ref<Error | null | undefined>>
}

export function useTerminalReader<T>(
  readable: MaybeRefOrGetter<ReadableStream<T> | null | undefined>,
  options?: UseTerminalReaderOptions<T>,
): UseTerminalReaderReturn {
  const {
    handle: reader,
    error,
    isPending,
    start,
    stop,
  }: UseStreamLockReturn<ReadableStreamDefaultReader<T>> = useStreamLock(
    readable,
    stream => stream.getReader(),
  )

  watchImmediate(reader, async (activeReader) => {
    const onRead = options?.onRead

    if (!activeReader || !onRead)
      return

    try {
      await readLoop(activeReader, onRead)
    }
    catch (cause) {
      // Releasing the lock on a stopped or replaced reader rejects the pending
      // read. That is teardown, not a failure of the target, so it stays out
      // of `error`.
      if (reader.value !== activeReader)
        return
      error.value = cause as Error
    }
    finally {
      if (reader.value === activeReader)
        stop()
    }
  })

  return {
    isPending,
    error: readonly(error),
    start,
    stop,
  }
}

async function readLoop<T>(
  reader: ReadableStreamDefaultReader<T>,
  onRead: (data: T) => Promise<void> | void,
) {
  while (true) {
    const result = await reader.read()
    if (result.value) {
      await onRead(result.value)
    }
    if (result.done) {
      break
    }
  }
}
