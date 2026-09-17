import { watchImmediate } from "@vueuse/core"

export interface UseTerminalReaderOptions<T> {
  onRead?: (data: T) => Promise<void> | void
}

export function useTerminalReader<T>(
  readable: MaybeRefOrGetter<ReadableStream<T> | null | undefined>,
  options?: UseTerminalReaderOptions<T>
) {
  const reader = shallowRef<ReadableStreamDefaultReader<T>>()
  const error = shallowRef<Error>()

  watchImmediate(() => toValue(readable), readable => {
    reader.value = readable?.getReader()
  })

  function cleanup() {
    reader.value = void 0
  }

  watchImmediate(reader, (reader, oldReader) => {
    console.debug("reader", reader)
    oldReader?.releaseLock();

    const onRead = options?.onRead;
    if (reader && onRead) {
      readLoop(reader, onRead).catch(e => {
        error.value = e instanceof Error ? e : new Error("Unable to consume stream", { cause: e })
      }).then(() => {
        cleanup()
      })
    }
  })


  return {
    cancel: async () => { 
      await reader.value?.cancel()
    },
    error: readonly(error),
  }
}

async function readLoop<T>(
  reader: ReadableStreamDefaultReader<T>,
  onRead: (data: T) => Promise<void> | void,
) {
  while (reader) {
    const result = await reader.read()
    if (result.value) {
      await onRead(result.value)
    }
    if (result.done) {
      break
    }
  }
}
