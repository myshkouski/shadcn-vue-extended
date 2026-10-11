import type { ShallowRef } from 'vue'
import type { TerminalLineEncoder } from '../encoders'
import type { TerminalLineEntry, UseTerminalOutputOptions, UseTerminalOutputReturn } from '../useTerminalOutput'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, isProxy, isReactive, nextTick, shallowRef, watchEffect } from 'vue'
import { decodeHex, decodeText } from '../encoders'
import { useTerminalOutput } from '../useTerminalOutput'

/**
 * A buffer: writes reach it as they are appended, so every test below
 * asserts on what a write produced.
 */
function run(options?: UseTerminalOutputOptions): UseTerminalOutputReturn {
  return useTerminalOutput(options)
}

function encode(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

/**
 * The buffer's lines as an array. `entries` is declared an iterable of
 * lines, the open line as its last element.
 */
function lines(result: UseTerminalOutputReturn): TerminalLineEntry[] {
  return [...result.entries]
}

/**
 * The line currently being written to: the last element of the buffer,
 * or `undefined` when no line is open.
 */
function openLine(result: UseTerminalOutputReturn): TerminalLineEntry | undefined {
  return lines(result).at(-1)
}

/**
 * The whole buffer, open line included: what a consumer copying the
 * output would read. Tests about what is on screen read `entries`
 * directly.
 */
function contents(result: UseTerminalOutputReturn): string[] {
  return lines(result).map(entry => entry.content)
}

// The default hex row is sixteen bytes, which makes short inputs awkward to
// assert on.
const hex4: TerminalLineEncoder = { ...decodeHex, lineBytes: 4 }

describe('terminal output buffer with text encoder', () => {
  it('splits data into lines and keeps the break in the content', () => {
    const result = run()
    const { append } = result

    append(encode('first\nsecond\r\n'), 'output')

    expect(contents(result)).toEqual(['first\n', 'second\r\n'])
  })

  it('gives the stream back when the lines are concatenated', () => {
    const result = run()
    const { append } = result
    append(encode('abc'), 'output')
    append(encode('def\n'), 'output')
    append(encode('ghi\r\n'), 'output')

    expect(contents(result).join('')).toBe('abcdef\nghi\r\n')
  })

  it('splits on a lone CR as well', () => {
    const result = run()
    const { append } = result

    append(encode('a\rb\r\nc\n'), 'output')

    expect(contents(result)).toEqual(['a\r', 'b\r\n', 'c\n'])
  })

  it('continues the open line while no break arrives', () => {
    const result = run()
    const { append } = result

    append(encode('no newline '), 'output')
    append(encode('yet'), 'output')

    // Still open, so it is the last element: nothing has sealed it into
    // a cold line yet.
    expect(lines(result)).toHaveLength(1)
    expect(openLine(result)!.content).toBe('no newline yet')
    expect(contents(result)).toEqual(['no newline yet'])
  })

  it('writes the text of a line once and never rewrites it', () => {
    const encodeText = vi.fn((bytes: Uint8Array) => new TextDecoder().decode(bytes))
    const result = run({
      encode: { kind: 'text', encode: encodeText },
    })
    const { append } = result

    append(encode('ab'), 'output')

    // Reading a line never runs the encoder again.
    expect(contents(result)).toEqual(['ab'])
    expect(encodeText).toHaveBeenCalledTimes(1)

    append(encode('c\n'), 'output')

    // The line is a cold entry of its own now, holding what the open
    // line grew into. Nothing about it was decoded to render it: the
    // text arrived with the write that completed it.
    expect(lines(result)).toHaveLength(1)
    expect(openLine(result)!.content).toBe('abc\n')
    expect(encodeText).toHaveBeenCalledTimes(2)
  })

  it('renders a character left incomplete by a write as a replacement', () => {
    const result = run()
    const { append } = result
    const bytes = encode('→')

    // The line is rendered as it is written, so a character whose bytes have
    // not all arrived yet cannot be rendered as itself: the line reads as what
    // was complete at the time, while the bytes themselves are all kept.
    append(bytes.slice(0, 2), 'output')
    expect(openLine(result)!.content).toBe('\uFFFD')

    append(bytes.slice(2), 'output')

    expect(openLine(result)!.content).toBe('\uFFFD\uFFFD')
    expect(openLine(result)!.bytes.length).toBe(3)
  })

  it('counts real bytes, not characters, when truncating a line', () => {
    const onTruncate = vi.fn()
    const result = run({
      maxLineBytes: 3,
      onTruncate,
    })
    const { append, truncatedBytes } = result

    // `éé!` is five bytes: three are kept and two are dropped from the end.
    append(encode('éé!'), 'output')

    const entry = openLine(result)!

    expect([...entry.bytes]).toEqual([0xC3, 0xA9, 0xC3])
    // The third byte starts a character the line does not hold the rest of.
    expect(entry.content).toBe('é\uFFFD')
    expect(entry.droppedBytes).toBe(2)
    expect(truncatedBytes.value).toBe(2)
    expect(onTruncate).toHaveBeenCalledWith(2)
  })

  it('evicts the oldest lines once the buffer runs out of room', () => {
    const result = run({ maxBytes: 6 })
    const { append } = result

    append(encode('one\ntwo\nthree\n'), 'output')

    expect(contents(result)).toEqual(['three\n'])
  })

  it('encodes text into bytes and keeps the line type', () => {
    const result = run()
    const { append } = result

    append('ready ', 'input')
    append('now\n', 'system')

    expect(contents(result)).toEqual(['ready now\n'])
    expect(lines(result)[0]!.type).toBe('input')
  })
})

describe('terminal output buffer with binary encoder', () => {
  it('renders a line only once it holds its full length', () => {
    const result = run({ encode: hex4 })
    const { append } = result

    append(Uint8Array.of(0x47, 0x50, 0x52), 'output')
    expect(lines(result)).toEqual([])

    append(Uint8Array.of(0x4D, 0x43), 'output')
    expect(contents(result)).toEqual(['47 50 52 4d'])

    append(Uint8Array.of(0x2C, 0x2C), 'output')
    expect(contents(result)).toEqual(['47 50 52 4d'])

    // Overflowing the line renders it, and the next line starts from the byte
    // that was left over plus what came after it.
    append(Uint8Array.of(0x56, 0x2C), 'output')

    expect(contents(result)).toEqual(['47 50 52 4d', '43 2c 2c 56'])
  })

  it('holds every line to the same byte length', () => {
    const result = run({ encode: decodeHex })
    const { append } = result

    append(Uint8Array.from({ length: 40 }, (_, index) => index), 'output')

    // Sixteen bytes per line by default, and the eight bytes that do not fill a
    // line are held back rather than rendered short.
    expect(lines(result).map(entry => entry.bytes.length)).toEqual([16, 16])
    expect(contents(result)[0]).toBe('00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f')
  })

  it('holds back the bytes that do not fill a line yet', () => {
    const result = run({ encode: hex4 })
    const { append } = result
    append(Uint8Array.of(1, 2, 3, 4, 5, 6, 7), 'output')
    expect(contents(result)).toEqual(['01 02 03 04'])

    append(Uint8Array.of(8), 'output')
    expect(contents(result)).toEqual(['01 02 03 04', '05 06 07 08'])
  })

  it('honours a custom line length', () => {
    const result = run({ encode: hex4 })
    const { append } = result

    append(Uint8Array.of(1, 2, 3, 4, 5, 6), 'output')

    expect(contents(result)).toEqual(['01 02 03 04'])
  })

  it('reads the bytes through a DataView over the chunk', () => {
    const seen: { length: number, byteLength: number }[] = []
    const result = run({
      encode: {
        kind: 'binary',
        lineBytes: 2,
        encode: (bytes, view) => {
          seen.push({ length: bytes.length, byteLength: view.byteLength })

          return [...Array.from({ length: bytes.length })].map((_, index) => view.getUint8(index).toString(16)).join('')
        },
      },
    })
    const { append } = result

    append(Uint8Array.of(0xAB, 0xCD), 'output')

    expect(seen).toEqual([{ length: 2, byteLength: 2 }])
  })

  it('renders a custom text form of binary lines', () => {
    const result = run({
      encode: {
        kind: 'binary',
        lineBytes: 4,
        encode: bytes => new TextDecoder('latin1').decode(bytes),
      },
    })
    const { append } = result

    append(Uint8Array.of(0x41, 0x42, 0x43, 0x44, 0x45), 'output')

    expect(contents(result)).toEqual(['ABCD'])
  })

  it('never splits a line at a byte that looks like a line break', () => {
    const result = run({ encode: hex4 })
    const { append } = result

    // 0x0a and 0x0d are data here: a binary line is cut at its byte length and
    // nowhere else.
    append(Uint8Array.of(0x41, 0x0A, 0x0D, 0x0A), 'output')

    expect(contents(result)).toEqual(['41 0a 0d 0a'])

    append(Uint8Array.of(0x42, 0x0A, 0x0D, 0x0A), 'output')

    expect(contents(result)).toEqual(['41 0a 0d 0a', '42 0a 0d 0a'])
  })

  it('counts bytes of a line that has not been rendered yet', () => {
    const result = run({ encode: hex4 })
    const { append, sizeBytes } = result

    append(Uint8Array.of(0x47, 0x50), 'output')

    expect(lines(result)).toEqual([])
    expect(sizeBytes.value).toBe(2)
  })

  it('keeps a binary line within maxLineBytes', () => {
    const result = run({
      encode: decodeHex,
      maxLineBytes: 4,
    })
    const { append, sizeBytes, truncatedBytes } = result

    append(Uint8Array.of(1, 2, 3, 4, 5, 6), 'output')

    // The line length is capped by the buffer, so no byte of a full line counts
    // as dropped: the row is four bytes wide instead of sixteen.
    expect(contents(result)).toEqual(['01 02 03 04'])
    expect(sizeBytes.value).toBe(6)
    expect(truncatedBytes.value).toBe(0)
  })
})

describe('terminal output buffer encoder switching', () => {
  it('keeps the lines already written and uses the new encoder for the next ones', () => {
    const encoder = shallowRef<TerminalLineEncoder>(decodeText)
    const result = run({ encode: encoder })
    const { append } = result

    append(encode('typed\n'), 'output')
    encoder.value = hex4
    append(Uint8Array.of(0x47, 0x50, 0x52, 0x4D), 'output')

    expect(contents(result)).toEqual(['typed\n', '47 50 52 4d'])
  })

  it('drops the bytes of a binary line that never filled up', () => {
    const encoder = shallowRef<TerminalLineEncoder>(hex4)
    const result = run({ encode: encoder })
    const { append, sizeBytes, truncatedBytes } = result
    append(Uint8Array.of(0x47, 0x50, 0x52), 'output')
    expect(truncatedBytes.value).toBe(0)

    encoder.value = decodeText
    append(encode('text\n'), 'output')

    expect(contents(result)).toEqual(['text\n'])
    expect(truncatedBytes.value).toBe(3)
    expect(sizeBytes.value).toBe(5)
  })
})

describe('terminal output buffer reactivity', () => {
  it('re-renders the open line as more bytes are written to it', async () => {
    const result = run()
    const { append } = result
    const rendered: string[] = []
    const seenIds: (string | undefined)[][] = []

    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        // What the output content component watches: the list of lines,
        // and the content of the last one, which is the open line.
        rendered.length = 0
        rendered.push(...contents(result))
        seenIds.push([lines(result)[0]?.id, openLine(result)?.id])
      })
    })

    append(encode('ab'), 'output')
    await nextTick()
    expect(rendered).toEqual(['ab'])
    // Nothing sealed yet: the list holds the open line alone, under the
    // id the sealed entry will carry.
    const openId = openLine(result)!.id
    expect(seenIds.at(-1)).toEqual([openId, openId])

    append(encode('c\n'), 'output')
    await nextTick()
    expect(rendered).toEqual(['abc\n'])
    // The line sealed: the last element is a frozen entry of its own
    // now, still under the id the open line carried, so the node Vue
    // rendered for the open line is the one it keeps for the sealed one.
    expect(Object.isFrozen(openLine(result)!)).toBe(true)
    expect(openLine(result)!.id).toBe(openId)
    expect(seenIds.at(-1)).toEqual([openId, openId])

    scope.stop()
  })

  it('never proxies, freezes or rewrites a published entry', () => {
    const result = run()
    const { append } = result

    append(encode('one\ntwo\n'), 'output')

    for (const entry of lines(result)) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(isProxy(entry)).toBe(false)
      expect(isReactive(entry)).toBe(false)
    }

    const [first] = lines(result)
    const content = first!.content

    append(encode('three\n'), 'output')

    // A line already on screen keeps its identity and its content: it is
    // the only thing that tells a renderer nothing about it changed.
    expect(lines(result)[0]).toBe(first)
    expect(first!.content).toBe(content)
  })

  it('leaves the cold list alone while only the open line grows', () => {
    const result = run()
    const { entries, append } = result

    append(encode('first\n'), 'output')
    append(encode('open'), 'output')

    // The line opened, which published the list it went onto.
    const list = entries

    append(encode('ing'), 'output')

    // Growing it published nothing: the list is the same object, the
    // sealed line on it is the same object, and the open line behind
    // them is the same element, which repaints through its own
    // reactivity rather than through this ref.
    expect(entries).toBe(list)
    expect(lines(result)).toHaveLength(2)
    expect(openLine(result)!.content).toBe('opening')
  })

  it('keeps the open line last, and it is the only entry that mutates', () => {
    const result = run()
    const { append } = result

    append(encode('one\ntwo\n'), 'output')
    const sealed = lines(result)

    append(encode('open'), 'output')
    append(encode('ing'), 'output')

    const current = lines(result)

    // The open line is the last element, and the sealed lines in front of
    // it are the very objects they were: the list was published once,
    // for the line that opened.
    expect(current).toHaveLength(3)
    expect(current[0]).toBe(sealed[0])
    expect(current[1]).toBe(sealed[1])
    expect(openLine(result)!.content).toBe('opening')

    // The one entry that is not frozen is the one that grew: a sealed
    // entry is raw and frozen, and the open line is reactive.
    expect(Object.isFrozen(openLine(result)!)).toBe(false)
    expect(isReactive(openLine(result))).toBe(true)
  })

  it('gives every line an id unique across a long run', () => {
    const result = run()
    const { append } = result

    for (let index = 0; index < 2_000; index++)
      append(encode(`line ${index}\n`), 'output')

    // Every line is still on screen, so a repeated id would make Vue
    // reuse the node of a line that is gone.
    expect(lines(result)).toHaveLength(2_000)
    expect(new Set(lines(result).map(entry => entry.id)).size).toBe(2_000)
  })

  it('gives the open line an id that survives the seal', () => {
    const result = run()
    const { append } = result

    append(encode('ab'), 'output')
    const open = openLine(result)!
    const { id } = open

    append(encode('c'), 'output')

    // The same line, grown in place rather than replaced: the row
    // rendered for it repaints through the line's own reactivity.
    expect(openLine(result)).toBe(open)
    expect(open.content).toBe('abc')

    append(encode('\n'), 'output')

    // Sealed as a frozen entry under the id the open line carried, so
    // the node Vue rendered for the open line is the one it keeps for
    // the sealed one.
    const sealed = openLine(result)!
    expect(sealed).not.toBe(open)
    expect(Object.isFrozen(sealed)).toBe(true)
    expect(sealed.id).toBe(id)
    expect(sealed.content).toBe('abc\n')
  })

  it('clears lines and pending bytes', () => {
    const result = run({ encode: decodeHex })
    const { append, clear, sizeBytes, truncatedBytes } = result

    append(Uint8Array.of(1, 2, 3), 'output')
    clear()

    expect(lines(result)).toEqual([])
    expect(openLine(result)).toBeUndefined()
    expect(sizeBytes.value).toBe(0)
    expect(truncatedBytes.value).toBe(0)
  })

  it('keeps seeds cold and starts with no open line', () => {
    const result = run({
      initialEntries: [
        { type: 'system', content: 'ready\n' },
        { type: 'output', content: Uint8Array.of(0x47, 0x50) },
      ],
    })

    // Every seed is a whole line, whatever the encoder would do with a stream.
    expect(contents(result)).toEqual(['ready\n', 'GP'])
    expect(Object.isFrozen(openLine(result)!)).toBe(true)
  })

  it('calls onTruncate once per eviction burst rather than once per line', () => {
    const onTruncate = vi.fn()
    const result = run({ maxBytes: 6, onTruncate })
    const { append } = result

    append(encode('one\ntwo\nthree\nfour\n'), 'output')

    expect(contents(result)).toEqual(['four\n'])
    expect(onTruncate).toHaveBeenCalledTimes(1)
    // The three evicted lines amount to 14 bytes: `one\n`, `two\n`, `three\n`.
    expect(onTruncate).toHaveBeenCalledWith(14)
  })

  it('keeps truncatedBytes a number until it passes MAX_SAFE_INTEGER', () => {
    const result = run({ maxLineBytes: 1 })
    const { append, truncatedBytes } = result

    append(encode('ab'), 'output')

    // A drop while the counter is still a plain number keeps it one.
    expect(truncatedBytes.value).toBe(1)

    // The counter is not capped by `maxBytes`, so it can outgrow a `number`.
    // Seeded right below the limit: the two bytes dropped by the next write
    // have to push it past, where a plain number would stop counting exactly.
    const counter = truncatedBytes as ShallowRef<number | bigint>
    counter.value = Number.MAX_SAFE_INTEGER - 1

    append(encode('cd'), 'output')

    expect(typeof truncatedBytes.value).toBe('bigint')
    expect(truncatedBytes.value).toBe(BigInt(Number.MAX_SAFE_INTEGER + 1))
  })

  it('seals an open text line when the encoder switches', () => {
    const encoder = shallowRef<TerminalLineEncoder>(decodeText)
    const result = run({ encode: encoder })
    const { append } = result

    append(encode('unterminated'), 'output')
    encoder.value = hex4
    append(Uint8Array.of(0x47, 0x50, 0x52, 0x4D), 'output')

    // Its bytes were valid; only the terminator was missing, so the line keeps
    // them rather than dropping a stream the user can read.
    expect(contents(result)).toEqual(['unterminated', '47 50 52 4d'])
    expect(lines(result)[0]!.type).toBe('output')
  })

  it('does not re-enter the drain when a truncation handler appends', () => {
    const calls: string[] = []
    const result = run({
      maxBytes: 4,
      onTruncate(bytes) {
        calls.push(`truncated:${bytes}`)
        // Re-entrancy: this runs while the buffer is still draining, so the
        // write must queue for the next pass instead of corrupting the one in
        // progress.
        result.append(encode('!'), 'system')
      },
    })
    const { append } = result

    append(encode('aaaa\nbbbb\ncccc\n'), 'output')

    expect(calls.length).toBeGreaterThan(0)
    // The handler's own writes were drained rather than lost or interleaved.
    expect(contents(result).join('')).toContain('cccc\n')
  })
})

describe('terminal output buffer write through', () => {
  it('writes a chunk into the buffer on the append', () => {
    const result = run()
    const { append } = result

    append(encode('written\n'), 'output')

    // Nothing waits for a schedule: what was appended is in the buffer
    // by the time the append returns, open line included.
    expect(contents(result)).toEqual(['written\n'])

    append(encode('still open'), 'output')

    expect(contents(result)).toEqual(['written\n', 'still open'])
  })

  it('decodes once per append, which is what the reader paces', () => {
    const lengths: number[] = []
    const result = run({
      encode: {
        kind: 'text',
        encode: (bytes) => {
          lengths.push(bytes.length)

          return new TextDecoder().decode(bytes)
        },
      },
    })
    const { append } = result

    append(encode('abc'), 'output')
    append(encode('de'), 'output')
    append(encode('f'), 'output')

    // One chunk is one decode. Nothing merges them any more: a device
    // that writes as fast as the event loop turns is paced by the reader
    // before it reaches the buffer, and rendering is coalesced by Vue.
    expect(lengths).toEqual([3, 2, 1])
    expect(contents(result)).toEqual(['abcdef'])
  })

  it('keeps the encoder a chunk was appended with, whatever is active at the next append', () => {
    const encoder = shallowRef<TerminalLineEncoder>(decodeText)
    const result = run({ encode: encoder })
    const { append } = result

    append(encode('typed\n'), 'output')
    encoder.value = hex4
    append(Uint8Array.of(0x47, 0x50, 0x52, 0x4D), 'output')

    expect(contents(result)).toEqual(['typed\n', '47 50 52 4d'])
  })
})
