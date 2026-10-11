import type { Stoppable } from '@vueuse/core'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { UseTerminalReaderOptions } from './useTerminalReader'
import type { UseTerminalWriterOptions } from './useTerminalWriter'
import { notNullish, tryOnScopeDispose } from '@vueuse/core'
import { computed, toValue } from 'vue'
import { useTerminalReader } from './useTerminalReader'
import { useTerminalWriter } from './useTerminalWriter'

export interface UseSerialTerminalOptions extends UseTerminalReaderOptions<Uint8Array>, UseTerminalWriterOptions {}
export interface UseSerialTerminalReturn extends Stoppable {
  write: (chunk: Uint8Array) => Promise<void>
  stop: () => void
  readonly errors: Readonly<Ref<readonly Error[]>>
  readonly state: Readonly<Ref<SerialTerminalState>>
}

export interface SerialTerminalTarget {
  readable?: ReadableStream<Uint8Array> | null
  writable?: WritableStream<Uint8Array> | null
}

export type SerialTerminalState = {
  readable: boolean;
  writable: boolean;
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
    // The reader's own options ride along with the writer's, of which only
    // `onRead` belongs here.
    ...options,
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

  const state = computed<SerialTerminalState>(() => {
    return {
      readable: isReaderPending.value,
      writable: isWriterPending.value,
    }
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
    state,
    isPending,
    errors,
    write,
    start,
    stop,
  }
}
