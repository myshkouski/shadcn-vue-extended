import type { Stoppable } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'
import type { UseTerminalReaderOptions } from './useTerminalReader'
import type { UseTerminalWriterOptions } from './useTerminalWriter'
import { notNullish, tryOnScopeDispose } from '@vueuse/core'
import { useTerminalReader } from './useTerminalReader'
import { useTerminalWriter } from './useTerminalWriter'

export interface UseSerialTerminalOptions extends UseTerminalReaderOptions<Uint8Array>, UseTerminalWriterOptions {}
export interface UseSerialTerminalReturn extends Stoppable {
  write: (chunk: Uint8Array) => Promise<void>
  stop: () => void
  readonly errors: Readonly<Ref<readonly Error[]>>
}

export interface SerialTerminalTarget {
  readable?: ReadableStream<Uint8Array> | null
  writable?: WritableStream<Uint8Array> | null
}

export function useSerialTerminal(
  target: MaybeRefOrGetter<SerialTerminalTarget | null | undefined>,
  options?: UseSerialTerminalOptions,
): UseSerialTerminalReturn {
  const readable = () => toValue(target)?.readable
  const {
    isPending: isReaderPending,
    error: readerError,
    start: startReader,
    stop: stopReader,
  } = useTerminalReader(readable, {
    onRead: options?.onRead,
  })

  const writable = () => toValue(target)?.writable
  const {
    isPending: isWriterPending,
    error: writerError,
    start: startWriter,
    stop: stopWriter,
    write,
  } = useTerminalWriter(writable)

  const isPending = computed(() => {
    return isReaderPending.value && isWriterPending.value
  })

  function start() {
    startReader()
    startWriter()
  }

  function stop() {
    stopReader()
    stopWriter()
  }

  tryOnScopeDispose(() => {
    stop()
  })

  const errors = computed(() => {
    return [
      readerError.value,
      writerError.value,
    ].filter(notNullish)
  })

  return {
    isPending,
    errors,
    write,
    start,
    stop,
  }
}
