import { describe, expect, it, vi } from 'vitest'
import { effectScope, isProxy, nextTick, reactive, shallowRef } from 'vue'
import { useStreamLock } from '../useStreamLock'
import { useTerminalReader } from '../useTerminalReader'
import { useTerminalWriter } from '../useTerminalWriter'

describe('terminal reader/writer shared lock behaviour', () => {
  it('exposes a pending flag that tracks the attached handle', async () => {
    const stream = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const readable = shallowRef<ReadableStream<Uint8Array> | null>(stream)

    const scope = effectScope()
    const { isPending } = scope.run(() => useTerminalReader(readable, { onRead: () => {} }))!

    expect(isPending.value).toBe(true)

    readable.value = null
    await nextTick()

    expect(isPending.value).toBe(false)

    scope.stop()
    expect(isPending.value).toBe(false)
  })

  it('surfaces a failed attachment as an error and stays detached', () => {
    // Driven through the internal helper rather than a watcher: a failing
    // attachment deliberately rethrows, which Vue would re-raise from the
    // scheduler and turn into an unhandled error.
    const stream = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const source = shallowRef<ReadableStream<Uint8Array> | null>(stream)

    const scope = effectScope()
    const { isPending, error, start, stop } = scope.run(() => useStreamLock(
      source,
      current => current.getReader(),
    ))!

    expect(isPending.value).toBe(true)

    // Someone else takes the lock, then the next attach attempt must fail.
    stop()
    const competitor = stream.getReader()

    expect(() => start()).toThrow(TypeError)
    expect(isPending.value).toBe(false)
    expect(error.value).toBeInstanceOf(TypeError)
    // The failed attempt must not have stolen or dropped the other lock.
    expect(stream.locked).toBe(true)

    competitor.releaseLock()
    scope.stop()
  })

  it('reports a write failure against the writer that caused it', async () => {
    const failure = new Error('sink is gone')
    const stream = new WritableStream<Uint8Array>({
      write: () => Promise.reject(failure),
    })
    const writable = shallowRef<WritableStream<Uint8Array> | null>(stream)

    const scope = effectScope()
    const { write, error } = scope.run(() => useTerminalWriter(writable))!

    await expect(write(new Uint8Array([1]))).rejects.toBe(failure)
    expect(error.value).toBe(failure)

    scope.stop()
  })

  it('swallows a write failure from a writer that was released mid-write', async () => {
    const writable = shallowRef<WritableStream<Uint8Array> | null>(null)

    writable.value = new WritableStream<Uint8Array>({
      write: async () => {
        // Replace the writer while this write is still in flight, which is what
        // a target switch does.
        writable.value = null
        await Promise.resolve()
        throw new Error('aborted by teardown')
      },
    })

    const scope = effectScope()
    const { write, error } = scope.run(() => useTerminalWriter(writable))!

    await expect(write(new Uint8Array([1]))).resolves.toBeUndefined()
    expect(error.value).toBeUndefined()

    scope.stop()
  })

  it('hands attach the raw stream, never a reactive wrapper', () => {
    // Vue proxies plain objects, so a stream-like test double can arrive
    // wrapped. `attach` must see the stream itself.
    let seen: unknown
    const stream = {
      locked: false,
      getReader() {
        return { read: async () => ({ done: true }), releaseLock: () => {} }
      },
    }

    const source = shallowRef<typeof stream | null>(reactive(stream) as typeof stream)

    const scope = effectScope()
    scope.run(() => useStreamLock(source, (current) => {
      seen = current
      return current.getReader()
    }))

    expect(isProxy(source.value)).toBe(true)
    expect(seen).toBe(stream)

    scope.stop()
  })

  it('leaves native streams untouched', () => {
    const stream = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const source = shallowRef<ReadableStream<Uint8Array> | null>(stream)

    let seen: unknown
    const scope = effectScope()
    scope.run(() => useStreamLock(source, (current) => {
      seen = current
      return current.getReader()
    }))

    expect(seen).toBe(stream)
    expect(isProxy(seen)).toBe(false)

    scope.stop()
  })

  it('reads chunks through onRead until the stream ends', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new Uint8Array([1]))
        controller.enqueue(new Uint8Array([2]))
        controller.close()
      },
    })
    const readable = shallowRef<ReadableStream<Uint8Array> | null>(stream)
    const onRead = vi.fn()

    const scope = effectScope()
    const { isPending } = scope.run(() => useTerminalReader(readable, { onRead }))!

    await vi.waitFor(() => expect(onRead).toHaveBeenCalledTimes(2))

    // The loop ended on its own, so the reader detached itself.
    await vi.waitFor(() => expect(isPending.value).toBe(false))

    scope.stop()
  })
})
