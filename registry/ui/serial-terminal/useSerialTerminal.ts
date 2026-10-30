import type { MaybeRef, MaybeRefOrGetter, Stoppable } from '@vueuse/core'
import type { Ref } from 'vue'
import type { TerminalDecodedLine, TerminalLineEncoder } from './encoders'
import type { UseTerminalReaderOptions } from './useTerminalReader'
import type { UseTerminalWriterOptions } from './useTerminalWriter'
import { notNullish, tryOnScopeDispose, watchImmediate } from '@vueuse/core'
import { computed, shallowRef, toValue } from 'vue'
import { createLineDecoder } from './encoders'
import { useTerminalReader } from './useTerminalReader'
import { useTerminalWriter } from './useTerminalWriter'

export interface UseSerialTerminalOptions
  extends UseTerminalReaderOptions<Uint8Array | TerminalDecodedLine>, UseTerminalWriterOptions {
  /**
   * Encoder whose decoding is lifted onto a transform stream. A binary encoder
   * pipes the target's readable through a {@link HexDecoderStream}, so how the
   * device's bytes become lines is decoded by a stream. A text encoder — or none
   * at all — leaves decoding inline in the buffer, where a partial line can still
   * be rendered as it grows.
   */
  encode?: MaybeRef<TerminalLineEncoder>
  /** Caps a binary decoder's line length to the buffer's `maxLineBytes`. */
  maxLineBytes?: MaybeRef<number>
}

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

export interface SerialTerminalState {
  readable: boolean
  writable: boolean
}

export function useSerialTerminal(
  target: MaybeRefOrGetter<SerialTerminalTarget | null | undefined>,
  options?: UseSerialTerminalOptions,
): UseSerialTerminalReturn {
  // The readable the reader attaches to. When `encode` selects a binary decoder
  // the target's byte stream is run through a transform stream, so bytes become
  // decoded lines before they reach the buffer; text and unencoded targets keep
  // the raw byte stream and decode inline in the buffer.
  const decodedReadable = shallowRef<ReadableStream<Uint8Array | TerminalDecodedLine> | null | undefined>()

  // Tearing a device down must not race a pipe still holding its readable: the
  // previous decoder is aborted first, which cancels its pipe and frees the
  // previous source's lock for the next device to close/cancel it.
  let abortDecoder: (() => void) | undefined

  watchImmediate(
    () => [toValue(target)?.readable, toValue(options?.encode), toValue(options?.maxLineBytes)] as const,
    ([source, encoder, cap]) => {
      abortDecoder?.()
      abortDecoder = undefined

      if (!source) {
        decodedReadable.value = null
        return
      }

      const decoder = createLineDecoder(encoder, cap)
      if (!decoder) {
        decodedReadable.value = source
        return
      }

      const controller = new AbortController()
      abortDecoder = () => controller.abort()
      decodedReadable.value = source.pipeThrough(decoder, { signal: controller.signal })
    },
  )

  const {
    isPending: isReaderPending,
    error: readerError,
    start: startReader,
    stop: stopReader,
  } = useTerminalReader(decodedReadable, {
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
