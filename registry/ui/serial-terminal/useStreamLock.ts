import type { MaybeRefOrGetter, Stoppable } from '@vueuse/core'
import type { Ref } from 'vue'
import { tryOnScopeDispose, watchImmediate } from '@vueuse/core'
import { computed, shallowRef, toRaw, toValue } from 'vue'

/**
 * Anything that can hold a stream lock, i.e. a stream reader or writer.
 */
export interface StreamLockHandle {
  releaseLock: () => void
}

export interface UseStreamLockReturn<THandle extends StreamLockHandle> extends Stoppable {
  /**
   * The currently attached handle. Writable so callers can report failures
   * against the exact handle that produced them; public composables wrap this
   * in `readonly()`.
   */
  readonly handle: Ref<THandle | undefined>
  readonly isPending: Readonly<Ref<boolean>>
  readonly error: Ref<Error | undefined>
}

/**
 * Shared attachment lifecycle for a stream and one of its lock handles.
 *
 * `useTerminalReader` and `useTerminalWriter` differ only in which stream they
 * attach to and what they do with the handle afterwards (read a loop, write
 * chunks), so the attach/detach bookkeeping lives here once.
 *
 * @param stream the stream to hold a lock on, or a getter for it
 * @param attach takes a lock on the stream, e.g. `stream => stream.getReader()`.
 * Receives the raw stream, never a reactive wrapper around one.
 */
export function useStreamLock<TStream, THandle extends StreamLockHandle>(
  stream: MaybeRefOrGetter<TStream | null | undefined>,
  attach: (stream: TStream) => THandle,
): UseStreamLockReturn<THandle> {
  const handle = shallowRef<THandle>()
  const error = shallowRef<Error>()
  const isPending = computed(() => {
    return !!handle.value
  })

  // A handle can be released both here and by the watcher below, and
  // `releaseLock()` throws once a handle is no longer attached to its stream.
  const releasedHandles = new WeakSet<THandle & object>()

  function release(target: THandle | undefined) {
    if (!target || releasedHandles.has(target))
      return

    releasedHandles.add(target)
    target.releaseLock()
  }

  function start() {
    // Released up front rather than left to the watcher below: whoever switched
    // streams may close the previous one as soon as this returns, and a locked
    // stream rejects `cancel()`/`close()`.
    release(handle.value)

    try {
      const current = toValue(stream)

      // Normalised before it reaches `attach`. Vue never proxies a native
      // ReadableStream/WritableStream (they are host objects, so it passes them
      // through untouched and this is a no-op), but it does proxy stream-likes
      // that look like plain objects, and `attach` should get the stream itself
      // rather than a reactive wrapper that reads back as `this` inside
      // `getReader()`/`getWriter()`.
      handle.value = current == null ? void 0 : attach(toRaw(current))
    }
    catch (cause) {
      handle.value = void 0
      error.value = cause as Error
      throw cause
    }
    error.value = void 0
  }

  function stop() {
    // Detaches the handle and drops its lock right away, so the caller can tear
    // the stream down without waiting for a flush. Closing or cancelling the
    // stream itself stays the responsibility of whoever owns it.
    release(handle.value)
    handle.value = void 0
  }

  watchImmediate(() => toValue(stream), () => {
    start()
  })

  tryOnScopeDispose(() => {
    stop()
  })

  // Replacing the handle in `start()` still has to give the old lock back.
  watchImmediate(handle, (_, oldHandle) => {
    release(oldHandle)
  })

  return {
    handle,
    isPending,
    error,
    start,
    stop,
  }
}
