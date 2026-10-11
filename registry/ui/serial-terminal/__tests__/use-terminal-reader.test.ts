import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useTerminalReader } from '../useTerminalReader'

const encoder = new TextEncoder()

/**
 * A source with no pacing of its own: a chunk is ready by the time it is
 * asked for, so a reader that does not yield resolves every read on a
 * microtask and never reaches the task queue again — which is what stops
 * a page, rather than slowing it down.
 */
function unpacedStream(chunk: Uint8Array = encoder.encode('x')): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk)
    },
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

function startReader(
  readable: ReadableStream<Uint8Array>,
  options: Parameters<typeof useTerminalReader<Uint8Array>>[1],
) {
  const scope = effectScope()
  const reader = scope.run(() => useTerminalReader(readable, options))!

  reader.start()

  return {
    stop() {
      scope.stop()
    },
  }
}

describe('terminal reader throttle', () => {
  // A regression here does not fail an assertion, it starves the test runner's
  // own timers: these cases are on a deadline to report that.
  //
  // Node has neither `requestAnimationFrame` nor `requestIdleCallback`, so
  // these cases are also the tests of the fallbacks: a slice is followed by
  // a timer of the same length wherever the host hands out neither frames
  // nor idle time.
  for (const throttle of ['frame', 'idle', 'task'] as const) {
    it(`hands the main thread back while a source never stops, with '${throttle}'`, async () => {
      let ticks = 0
      const timer = setInterval(() => {
        ticks++
      }, 10)

      const handle = startReader(unpacedStream(), {
        throttle,
        throttleInterval: 0,
        onRead() {},
      })

      await wait(50)

      // Every read of this source resolves on a microtask, so a loop that
      // never yields would starve the interval above entirely.
      expect(ticks).toBeGreaterThan(0)

      clearInterval(timer)
      handle.stop()
    }, 2_000)
  }

  it('asks for idle time with a timeout, so a busy page is still shown what was read', async () => {
    const idleCallback = vi.fn((callback: () => void) => {
      setTimeout(callback, 0)

      return 1
    })
    vi.stubGlobal('requestIdleCallback', idleCallback)

    try {
      const handle = startReader(unpacedStream(), {
        throttle: 'idle',
        throttleInterval: 0,
        onRead() {},
      })

      await wait(50)

      expect(idleCallback).toHaveBeenCalled()
      // The timeout is what bounds the wait: idle time is handed out when
      // the main thread has nothing to do, which is exactly when a terminal
      // streaming into a buffer is not what the page is doing.
      expect(idleCallback.mock.calls[0]![1]).toEqual({ timeout: 100 })

      handle.stop()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a paced source to the end, in order', async () => {
    let written = 0

    const source = new ReadableStream<string>({
      pull(controller) {
        if (written >= 8) {
          controller.close()
          return
        }

        const chunk = `${written}`
        written++
        controller.enqueue(chunk)
      },
    })

    const received: string[] = []

    const handle = startReader(source, {
      throttle: 'none',
      onRead(chunk) {
        received.push(chunk)
      },
    })

    await vi.waitFor(() => {
      expect(received).toHaveLength(8)
    })

    expect(received).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])

    handle.stop()
  })

  it('waits for a frame between slices, which is what keeps a stream readable', async () => {
    const seen = vi.fn()

    const handle = startReader(unpacedStream(), {
      throttle: 'frame',
      onRead() {
        seen()
      },
    })

    await wait(50)

    expect(seen).toHaveBeenCalled()

    handle.stop()
  })
})
