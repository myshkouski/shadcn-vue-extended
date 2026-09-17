import { watchImmediate } from "@vueuse/core"

export interface UseTerminalWriterOptions {}

export function useTerminalWriter<T>(
  writable: MaybeRefOrGetter<WritableStream<T> | null | undefined>
) {
  const writer = shallowRef<WritableStreamDefaultWriter<T>>()
  const error = shallowRef<Error | null>(null)

  watchImmediate(() => toValue(writable), writable => {
    writer.value = writable?.getWriter()
  })

  watchImmediate(writer, (writer, oldWriter) => {
    oldWriter?.releaseLock()
  })

  return {
    async close() {
      await writer.value?.close()
    },
    error: readonly(error),
    async write(chunk: T) {
      try {
        await writer.value?.write(chunk)
      } catch (cause) {
        const e = cause instanceof Error
          ? cause
          : new Error("Unable to write", { cause })
        
        error.value = e

        throw e
      }
    },
  }
}
