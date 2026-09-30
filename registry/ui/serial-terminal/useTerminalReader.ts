import { tryOnScopeDispose, watchImmediate, type Stoppable } from '@vueuse/core'

export interface UseTerminalReaderOptions<T> {
  onRead?: (data: T) => Promise<void> | void
}

export interface UseTerminalReaderReturn extends Stoppable {
  error: Readonly<Ref<Error | null | undefined>>;
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

  function start() {
    try {
      reader.value = toValue(readable)?.getReader()
    } catch (e) {
      error.value = e as Error
      throw e
    }
    error.value = void 0
  }

  watchImmediate(() => toValue(readable), () => {
    start()
  })

  function stop() {
    reader.value = void 0
  }

  tryOnScopeDispose(() => {
    stop()
  })

  watchImmediate(reader, (_, oldReader) => {
    oldReader?.releaseLock()
  })

  watchImmediate(reader, async(reader) => {
    const onRead = options?.onRead
    if (reader && onRead) {
      readLoop(reader, onRead).catch((e) => {
        if (isPending.value) {
          error.value = e as Error
        }
      }).then(() => {
        stop()
      })
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
