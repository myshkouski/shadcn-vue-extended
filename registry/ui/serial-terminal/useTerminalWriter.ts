import type { MaybeRefOrGetter, Stoppable } from '@vueuse/core'
import type { Ref } from 'vue'
import type { UseStreamLockReturn } from './useStreamLock'
import { readonly } from 'vue'
import { useStreamLock } from './useStreamLock'

export interface UseTerminalWriterOptions { }
export interface UseTerminalWriterReturn<T> extends Stoppable {
  write: (chunk: T) => Promise<void>
  isPending: Readonly<Ref<boolean>>
  error: Readonly<Ref<Error | null | undefined>>
}

export function useTerminalWriter<T>(
  writable: MaybeRefOrGetter<WritableStream<T> | null | undefined>,
): UseTerminalWriterReturn<T> {
  const {
    handle: writer,
    error,
    isPending,
    start,
    stop,
  }: UseStreamLockReturn<WritableStreamDefaultWriter<T>> = useStreamLock(
    writable,
    stream => stream.getWriter(),
  )

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

  return {
    isPending,
    error: readonly(error),
    stop,
    start,
    write,
  }
}
