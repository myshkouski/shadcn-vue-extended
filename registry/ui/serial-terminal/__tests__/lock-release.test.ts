import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { useTerminalReader } from '../useTerminalReader'
import { useTerminalWriter } from '../useTerminalWriter'

describe('terminal reader/writer lock ownership', () => {
  it('releases the readable lock synchronously on stop', () => {
    const stream = new ReadableStream<Uint8Array>({
      start: () => {},
      cancel: () => {},
    })
    const target = { readable: stream }

    const scope = effectScope()
    const { stop } = scope.run(() => useTerminalReader(() => target.readable, {
      onRead: () => {},
    }))!

    expect(stream.locked).toBe(true)

    stop()

    // Teardown of the target must be possible without waiting for a flush.
    expect(stream.locked).toBe(false)
    expect(() => stream.cancel()).not.toThrow()

    scope.stop()
  })

  it('releases the writable lock synchronously on stop', () => {
    const stream = new WritableStream<Uint8Array>({
      write: () => {},
    })
    const target = { writable: stream }

    const scope = effectScope()
    const { stop } = scope.run(() => useTerminalWriter(() => target.writable))!

    expect(stream.locked).toBe(true)

    stop()

    expect(stream.locked).toBe(false)
    expect(() => stream.close()).not.toThrow()

    scope.stop()
  })

  it('releases the previous lock before attaching the next one', async () => {
    const first = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const second = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const readable = shallowRef<ReadableStream<Uint8Array> | null>(first)

    const scope = effectScope()
    const { error } = scope.run(() => useTerminalReader(readable, {
      onRead: () => {},
    }))!

    expect(first.locked).toBe(true)

    readable.value = second
    await nextTick()

    expect(first.locked).toBe(false)
    expect(second.locked).toBe(true)
    expect(error.value).toBeUndefined()

    scope.stop()
  })

  it('allows tearing down the previous target right after switching', async () => {
    const firstReadable = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const secondReadable = new ReadableStream<Uint8Array>({ start: () => {}, cancel: () => {} })
    const firstWritable = new WritableStream<Uint8Array>({ write: () => {} })
    const secondWritable = new WritableStream<Uint8Array>({ write: () => {} })

    const readable = shallowRef<ReadableStream<Uint8Array> | null>(firstReadable)
    const writable = shallowRef<WritableStream<Uint8Array> | null>(firstWritable)

    const scope = effectScope()
    scope.run(() => useTerminalReader(readable, { onRead: () => {} }))
    scope.run(() => useTerminalWriter(writable))

    expect(firstReadable.locked).toBe(true)
    expect(firstWritable.locked).toBe(true)

    // Switching targets, then tearing down what was switched away from — the
    // exact sequence a device swap performs.
    readable.value = secondReadable
    writable.value = secondWritable
    await nextTick()

    // This is what a real device teardown does: cancel + close the old streams.
    await expect(firstReadable.cancel()).resolves.toBeUndefined()
    await expect(firstWritable.close()).resolves.toBeUndefined()

    scope.stop()
  })
})
