import type { MaybeRefOrGetter, Stoppable } from '@vueuse/core'
import type { Ref } from 'vue'
import { tryOnScopeDispose, watchImmediate } from '@vueuse/core'
import { computed, readonly, shallowRef, toValue } from 'vue'

export interface UseTerminalReaderOptions<T> {
  onRead?: (data: T) => Promise<void> | void
}

export interface UseTerminalReaderReturn extends Stoppable {
  error: Readonly<Ref<Error | null | undefined>>
}

export function useTerminalReader<T>(
  readable: MaybeRefOrGetter<ReadableStream<T> | null | undefined>,
  options?: UseTerminalReaderOptions<T>,
): UseTerminalReaderReturn {
  const reader = shallowRef<ReadableStreamDefaultReader<T>>()
  const error = shallowRef<Error>()
  const isPending = computed(() => {
    return !!reader.value
  })

  // A reader can be detached both here and by the watcher below, and
  // `releaseLock()` throws once a reader is no longer attached to its stream.
  const detachedReaders = new WeakSet<ReadableStreamDefaultReader<T>>()

  function detach(target: ReadableStreamDefaultReader<T> | undefined) {
    if (!target || detachedReaders.has(target))
      return

    detachedReaders.add(target)
    target.releaseLock()
  }

  function start() {
    // Released up front rather than left to the watcher below: whoever switched
    // targets may close the previous one as soon as this returns, and a locked
    // stream rejects `cancel()`.
    detach(reader.value)

    try {
      reader.value = toValue(readable)?.getReader()
    }
    catch (e) {
      reader.value = void 0
      error.value = e as Error
      throw e
    }
    error.value = void 0
  }

  watchImmediate(() => toValue(readable), () => {
    start()
  })

  function stop() {
    // Detaches the reader and drops its lock right away, so the caller can tear
    // the target down without waiting for a flush. The stream itself stays
    // readable: tearing it down belongs to whoever owns it, not to the reader.
    detach(reader.value)
    reader.value = void 0
  }

  tryOnScopeDispose(() => {
    stop()
  })

  watchImmediate(reader, (_, oldReader) => {
    detach(oldReader)
  })

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
