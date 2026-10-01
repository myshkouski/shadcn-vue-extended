import type { TerminalLineEncoder } from '../encoders'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, watchEffect } from 'vue'
import { decodeHex, decodeText } from '../encoders'
import { useTerminalOutput } from '../useTerminalOutput'

function run<T>(callback: () => T): T {
  const scope = effectScope()
  const result = scope.run(callback)!
  scope.stop()
  return result
}

function encode(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

function contents(entries: Iterable<{ content: string }>): string[] {
  return [...entries].map(entry => entry.content)
}

// The default hex row is sixteen bytes, which makes short inputs awkward to
// assert on.
const hex4: TerminalLineEncoder = { ...decodeHex, lineBytes: 4 }

describe('terminal output buffer with text encoder', () => {
  it('splits data into lines and keeps the break in the content', () => {
    const { entries, append } = run(() => useTerminalOutput())

    append(encode('first\nsecond\r\n'), 'output')

    expect(contents(entries.value)).toEqual(['first\n', 'second\r\n'])
  })

  it('gives the stream back when the lines are concatenated', () => {
    const { entries, append } = run(() => useTerminalOutput())
    append(encode('abc'), 'output')
    append(encode('def\n'), 'output')
    append(encode('ghi\r\n'), 'output')

    expect(contents(entries.value).join('')).toBe('abcdef\nghi\r\n')
  })

  it('splits on a lone CR as well', () => {
    const { entries, append } = run(() => useTerminalOutput())

    append(encode('a\rb\r\nc\n'), 'output')

    expect(contents(entries.value)).toEqual(['a\r', 'b\r\n', 'c\n'])
  })

  it('continues the last line while no break arrives', () => {
    const { entries, append } = run(() => useTerminalOutput())

    append(encode('no newline '), 'output')
    append(encode('yet'), 'output')

    expect(contents(entries.value)).toEqual(['no newline yet'])
    expect([...entries.value]).toHaveLength(1)
  })

  it('writes the text of a line once and never rewrites it', () => {
    const encodeText = vi.fn((bytes: Uint8Array) => new TextDecoder().decode(bytes))
    const { entries, append } = run(() => useTerminalOutput({
      encode: { kind: 'text', encode: encodeText },
    }))

    append(encode('ab'), 'output')
    const first = [...entries.value][0]!

    // Reading a line never runs the encoder again.
    expect(contents(entries.value)).toEqual(['ab'])
    expect(encodeText).toHaveBeenCalledTimes(1)

    append(encode('c'), 'output')

    expect([...entries.value][0]).toBe(first)
    expect(first.content).toBe('abc')
    expect(encodeText).toHaveBeenCalledTimes(2)
  })

  it('renders a character left incomplete by a write as a replacement', () => {
    const { entries, append } = run(() => useTerminalOutput())
    const bytes = encode('→')

    // The line is rendered as it is written, so a character whose bytes have
    // not all arrived yet cannot be rendered as itself: the line reads as what
    // was complete at the time, while the bytes themselves are all kept.
    append(bytes.slice(0, 2), 'output')
    expect(contents(entries.value)).toEqual(['\uFFFD'])

    append(bytes.slice(2), 'output')

    expect(contents(entries.value)).toEqual(['\uFFFD\uFFFD'])
    expect([...entries.value][0]!.bytes.length).toBe(3)
  })

  it('counts real bytes, not characters, when truncating a line', () => {
    const onTruncate = vi.fn()
    const { entries, append, truncatedBytes } = run(() => useTerminalOutput({
      maxLineBytes: 3,
      onTruncate,
    }))

    // `éé!` is five bytes: three are kept and two are dropped from the end.
    append(encode('éé!'), 'output')

    const entry = [...entries.value][0]!

    expect([...entry.bytes]).toEqual([0xC3, 0xA9, 0xC3])
    // The third byte starts a character the line does not hold the rest of.
    expect(entry.content).toBe('é\uFFFD')
    expect(entry.droppedBytes).toBe(2)
    expect(truncatedBytes.value).toBe(2)
    expect(onTruncate).toHaveBeenCalledWith(2)
  })

  it('evicts the oldest lines once the buffer runs out of room', () => {
    const { entries, append } = run(() => useTerminalOutput({ maxBytes: 6 }))

    append(encode('one\ntwo\nthree\n'), 'output')

    expect(contents(entries.value)).toEqual(['three\n'])
  })

  it('encodes text into bytes and keeps the line type', () => {
    const { entries, append } = run(() => useTerminalOutput())

    append('ready ', 'input')
    append('now\n', 'system')

    expect(contents(entries.value)).toEqual(['ready now\n'])
    expect([...entries.value][0]!.type).toBe('input')
  })
})

describe('terminal output buffer with binary encoder', () => {
  it('renders a line only once it holds its full length', () => {
    const { entries, append } = run(() => useTerminalOutput({ encode: hex4 }))

    append(Uint8Array.of(0x47, 0x50, 0x52), 'output')
    expect([...entries.value]).toEqual([])

    append(Uint8Array.of(0x4D, 0x43), 'output')
    expect(contents(entries.value)).toEqual(['47 50 52 4d'])

    append(Uint8Array.of(0x2C, 0x2C), 'output')
    expect(contents(entries.value)).toEqual(['47 50 52 4d'])

    // Overflowing the line renders it, and the next line starts from the byte
    // that was left over plus what came after it.
    append(Uint8Array.of(0x56, 0x2C), 'output')

    expect(contents(entries.value)).toEqual(['47 50 52 4d', '43 2c 2c 56'])
  })

  it('holds every line to the same byte length', () => {
    const { entries, append } = run(() => useTerminalOutput({ encode: decodeHex }))

    append(Uint8Array.from({ length: 40 }, (_, index) => index), 'output')

    // Sixteen bytes per line by default, and the eight bytes that do not fill a
    // line are held back rather than rendered short.
    expect([...entries.value].map(entry => entry.bytes.length)).toEqual([16, 16])
    expect(contents(entries.value)[0]).toBe('00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f')
  })

  it('holds back the bytes that do not fill a line yet', () => {
    const { entries, append } = run(() => useTerminalOutput({ encode: hex4 }))

    append(Uint8Array.of(1, 2, 3, 4, 5, 6, 7), 'output')
    expect(contents(entries.value)).toEqual(['01 02 03 04'])

    append(Uint8Array.of(8), 'output')
    expect(contents(entries.value)).toEqual(['01 02 03 04', '05 06 07 08'])
  })

  it('honours a custom line length', () => {
    const { entries, append } = run(() => useTerminalOutput({ encode: hex4 }))

    append(Uint8Array.of(1, 2, 3, 4, 5, 6), 'output')

    expect(contents(entries.value)).toEqual(['01 02 03 04'])
  })

  it('reads the bytes through a DataView over the chunk', () => {
    const seen: { length: number, byteLength: number }[] = []
    const { append } = run(() => useTerminalOutput({
      encode: {
        kind: 'binary',
        lineBytes: 2,
        encode: (bytes, view) => {
          seen.push({ length: bytes.length, byteLength: view.byteLength })

          return [...Array.from({ length: bytes.length })].map((_, index) => view.getUint8(index).toString(16)).join('')
        },
      },
    }))

    append(Uint8Array.of(0xAB, 0xCD), 'output')

    expect(seen).toEqual([{ length: 2, byteLength: 2 }])
  })

  it('renders a custom text form of binary lines', () => {
    const { entries, append } = run(() => useTerminalOutput({
      encode: {
        kind: 'binary',
        lineBytes: 4,
        encode: bytes => new TextDecoder('latin1').decode(bytes),
      },
    }))

    append(Uint8Array.of(0x41, 0x42, 0x43, 0x44, 0x45), 'output')

    expect(contents(entries.value)).toEqual(['ABCD'])
  })

  it('never splits a line at a byte that looks like a line break', () => {
    const { entries, append } = run(() => useTerminalOutput({ encode: hex4 }))

    // 0x0a and 0x0d are data here: a binary line is cut at its byte length and
    // nowhere else.
    append(Uint8Array.of(0x41, 0x0A, 0x0D, 0x0A), 'output')

    expect(contents(entries.value)).toEqual(['41 0a 0d 0a'])

    append(Uint8Array.of(0x42, 0x0A, 0x0D, 0x0A), 'output')

    expect(contents(entries.value)).toEqual(['41 0a 0d 0a', '42 0a 0d 0a'])
  })

  it('counts bytes of a line that has not been rendered yet', () => {
    const { entries, append, sizeBytes } = run(() => useTerminalOutput({ encode: hex4 }))

    append(Uint8Array.of(0x47, 0x50), 'output')

    expect([...entries.value]).toEqual([])
    expect(sizeBytes.value).toBe(2)
  })

  it('keeps a binary line within maxLineBytes', () => {
    const { entries, append, sizeBytes, truncatedBytes } = run(() => useTerminalOutput({
      encode: decodeHex,
      maxLineBytes: 4,
    }))

    append(Uint8Array.of(1, 2, 3, 4, 5, 6), 'output')

    // The line length is capped by the buffer, so no byte of a full line counts
    // as dropped: the row is four bytes wide instead of sixteen.
    expect(contents(entries.value)).toEqual(['01 02 03 04'])
    expect(sizeBytes.value).toBe(6)
    expect(truncatedBytes.value).toBe(0)
  })
})

describe('terminal output buffer encoder switching', () => {
  it('keeps the lines already written and uses the new encoder for the next ones', () => {
    const encoder = shallowRef<TerminalLineEncoder>(decodeText)
    const { entries, append } = run(() => useTerminalOutput({ encode: encoder }))

    append(encode('typed\n'), 'output')
    encoder.value = hex4
    append(Uint8Array.of(0x47, 0x50, 0x52, 0x4D), 'output')

    expect(contents(entries.value)).toEqual(['typed\n', '47 50 52 4d'])
  })

  it('drops the bytes of a binary line that never filled up', () => {
    const encoder = shallowRef<TerminalLineEncoder>(hex4)
    const { entries, append, sizeBytes, truncatedBytes } = run(() => useTerminalOutput({ encode: encoder }))

    append(Uint8Array.of(0x47, 0x50, 0x52), 'output')
    expect(truncatedBytes.value).toBe(0)

    encoder.value = decodeText
    append(encode('text\n'), 'output')

    expect(contents(entries.value)).toEqual(['text\n'])
    expect(truncatedBytes.value).toBe(3)
    expect(sizeBytes.value).toBe(5)
  })
})

describe('terminal output buffer reactivity', () => {
  it('re-renders a line as more bytes are written to it', async () => {
    const { entries, append } = run(() => useTerminalOutput())
    const rendered: string[] = []

    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        rendered.length = 0
        rendered.push(...contents(entries.value))
      })
    })

    append(encode('ab'), 'output')
    await nextTick()
    expect(rendered).toEqual(['ab'])

    append(encode('c\n'), 'output')
    await nextTick()
    expect(rendered).toEqual(['abc\n'])

    scope.stop()
  })

  it('clears lines and pending bytes', () => {
    const { entries, append, clear, sizeBytes, truncatedBytes } = run(() => useTerminalOutput({ encode: decodeHex }))

    append(Uint8Array.of(1, 2, 3), 'output')
    clear()

    expect([...entries.value]).toEqual([])
    expect(sizeBytes.value).toBe(0)
    expect(truncatedBytes.value).toBe(0)
  })

  it('starts from seeded lines', () => {
    const { entries, sizeBytes } = run(() => useTerminalOutput({
      initialEntries: [
        { type: 'system', content: 'ready\n' },
        { type: 'output', content: Uint8Array.of(0x47, 0x50) },
      ],
    }))

    expect(contents(entries.value)).toEqual(['ready\n', 'GP'])
    expect(sizeBytes.value).toBe(8)
  })
})
