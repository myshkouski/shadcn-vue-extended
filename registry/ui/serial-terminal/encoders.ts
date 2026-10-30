/**
 * How the bytes a terminal receives become the lines it renders.
 *
 * The encoder is chosen when a line is written and decides both how the bytes
 * are grouped into lines and how each line is rendered as text. Lines are
 * rendered from the text they were written with, so a line never changes after
 * it appears: switching the encoder applies to the lines written next, not to
 * the ones already on screen.
 */
export type TerminalLineEncoder = TerminalTextEncoder | TerminalBinaryEncoder

/**
 * Text based lines: the bytes are decoded and split on the line breaks they
 * contain, which stay in the line text so that concatenating the lines gives
 * the stream back.
 */
export interface TerminalTextEncoder {
  readonly kind: 'text'
  /**
   * Turns the bytes of a line into text. Defaults to UTF-8.
   */
  readonly encode?: (bytes: Uint8Array) => string
}

/**
 * Binary lines: a fixed amount of bytes per line, rendered once the line is
 * full, so a byte stream shows up as a stream of fixed length rows rather than
 * as lines split at whatever bytes happen to look like a line break.
 */
export interface TerminalBinaryEncoder {
  readonly kind: 'binary'
  /**
   * Amount of bytes a rendered line holds. Defaults to
   * {@link DEFAULT_BINARY_LINE_BYTES}.
   */
  readonly lineBytes?: number
  /**
   * Turns the bytes of a line into text. Receives a `DataView` over the chunk
   * the line was written from, so a hex dump needs no copy of the data.
   * Defaults to hex pairs.
   */
  readonly encode?: (bytes: Uint8Array, view: DataView) => string
}

export const DEFAULT_BINARY_LINE_BYTES = 16

const HEX_GROUP_SIZE = 8

const LINE_FEED = 0x0A
const CARRIAGE_RETURN = 0x0D

const EMPTY_BYTES = new Uint8Array()

const textDecoder = new TextDecoder()

function decodeTextLine(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

function decodeHexLine(bytes: Uint8Array, view: DataView): string {
  const parts: string[] = []

  for (let index = 0; index < bytes.length; index++) {
    if (index > 0) {
      parts.push(index % HEX_GROUP_SIZE === 0 ? '  ' : ' ')
    }
    parts.push(view.getUint8(index).toString(16).padStart(2, '0'))
  }

  return parts.join('')
}

/**
 * Concatenates `chunk` onto `base`, reusing either side when there is nothing to
 * merge.
 */
function concatenate(base: Uint8Array, chunk: Uint8Array): Uint8Array {
  if (!base.length)
    return chunk
  if (!chunk.length)
    return base

  const merged = new Uint8Array(base.length + chunk.length)
  merged.set(base, 0)
  merged.set(chunk, base.length)

  return merged
}

/**
 * Renders bytes as UTF-8 text, one line per line break in the data.
 */
export const decodeText: TerminalTextEncoder = {
  kind: 'text',
  encode: decodeTextLine,
}

/**
 * Renders bytes as hex pairs, one line per {@link DEFAULT_BINARY_LINE_BYTES}
 * bytes, e.g. `47 50 52 4d  43 2c 2c 56 20 76 65 72  73 75 73`.
 */
export const decodeHex: TerminalBinaryEncoder = {
  kind: 'binary',
  lineBytes: DEFAULT_BINARY_LINE_BYTES,
  encode: decodeHexLine,
}

/**
 * A decoded terminal line emitted by a decoder stream.
 *
 * `bytes` is a view over the chunk the line was decoded from — handed off as-is
 * because a line is rendered once, when it is decoded, and never rewritten.
 */
export interface TerminalDecodedLine {
  readonly bytes: Uint8Array
  readonly content: string
}

/**
 * Options for a decoder stream built from an encoder.
 */
export interface DecoderStreamOptions {
  /** Amount of bytes a rendered binary line holds. */
  lineBytes?: number
  /**
   * Caps the line length to the buffer's `maxLineBytes`, so a decoder built
   * from an encoder never produces a row the buffer would have to truncate.
   */
  maxLineBytes?: number
  /** Renders a complete line as text. */
  encode?: (bytes: Uint8Array, view: DataView) => string
}

function resolveLineBytes(options: DecoderStreamOptions | undefined): number {
  return Math.max(
    1,
    Math.min(
      options?.lineBytes ?? DEFAULT_BINARY_LINE_BYTES,
      options?.maxLineBytes ?? Number.POSITIVE_INFINITY,
    ),
  )
}

/**
 * A `TransformStream` that decodes a binary byte stream into fixed-width hex
 * lines, grouping bytes into rows of `lineBytes`.
 *
 * A partial row is buffered until the next chunk completes it; when the source
 * ends the partial row is dropped, since an incomplete hex line has no
 * meaningful rendering and would only mislead.
 */
export class HexDecoderStream extends TransformStream<Uint8Array, TerminalDecodedLine> {
  private buffer: Uint8Array = EMPTY_BYTES
  private readonly lineBytes: number
  private readonly render: (bytes: Uint8Array, view: DataView) => string

  constructor(options: DecoderStreamOptions = {}) {
    super({
      transform: (chunk, controller) => {
        this.buffer = concatenate(this.buffer, chunk)

        while (this.buffer.length >= this.lineBytes) {
          const bytes = this.buffer.subarray(0, this.lineBytes)
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

          controller.enqueue({ bytes, content: this.render(bytes, view) })

          this.buffer = this.buffer.subarray(this.lineBytes)
        }
      },
      flush: () => {
        // An unfinished row is held back rather than shown short.
        this.buffer = EMPTY_BYTES
      },
    })

    this.lineBytes = resolveLineBytes(options)
    this.render = options.encode ?? decodeHexLine
  }
}

/**
 * A `TransformStream` that decodes a UTF-8 byte stream into lines, splitting on
 * `\r\n`, `\r` and `\n`. The separator is kept in each emitted line so that
 * concatenating the lines gives the stream back. A trailing partial line is
 * emitted as the last output of a chunk so it renders as the open line it is
 * rather than waiting behind a break that may never come.
 */
export class TextLineDecoderStream extends TransformStream<Uint8Array, TerminalDecodedLine> {
  private buffer: Uint8Array = EMPTY_BYTES
  private readonly render: (bytes: Uint8Array) => string

  constructor(options: { encode?: (bytes: Uint8Array) => string } = {}) {
    super({
      transform: (chunk, controller) => {
        this.buffer = concatenate(this.buffer, chunk)

        let index = 0
        while (index < this.buffer.length) {
          const byte = this.buffer[index]!

          let end: number
          if (byte === LINE_FEED) {
            end = index + 1
          }
          else if (byte === CARRIAGE_RETURN) {
            end = this.buffer[index + 1] === LINE_FEED ? index + 2 : index + 1
          }
          else {
            index++
            continue
          }

          const bytes = this.buffer.subarray(0, end)
          controller.enqueue({ bytes, content: this.render(bytes) })

          this.buffer = this.buffer.subarray(end)
          index = 0
        }
      },
      flush: (controller) => {
        if (this.buffer.length > 0) {
          const bytes = this.buffer
          controller.enqueue({ bytes, content: this.render(bytes) })
          this.buffer = EMPTY_BYTES
        }
      },
    })

    this.render = options.encode ?? decodeTextLine
  }
}

/**
 * Builds the decoder stream an encoder calls for, or `undefined` when the
 * encoder's decoding is left inline in the buffer.
 *
 * Binary encoders get a {@link HexDecoderStream} so their fixed-width rows are
 * decoded by a transform stream. Text encoders decode inline: a transform
 * stream emits a complete line at a time, and a text terminal must render a
 * partial line as it grows, so text decoding stays in the buffer where the
 * open line can be grown reactively.
 */
export function createLineDecoder(
  encoder: TerminalLineEncoder | undefined,
  maxLineBytes?: number,
): TransformStream<Uint8Array, TerminalDecodedLine> | undefined {
  if (!encoder)
    return undefined

  if (encoder.kind === 'text')
    return undefined

  return new HexDecoderStream({
    lineBytes: encoder.lineBytes,
    maxLineBytes,
    encode: encoder.encode ?? decodeHexLine,
  })
}

export { HexDecoderStream as BinaryDecoderStream }
export { TextLineDecoderStream as TextDecoderStream }

export { HexDecoderStream as BinaryStreamDecoder }
export { TextLineDecoderStream as TextLineStreamDecoder }
export { TextLineDecoderStream as LineDecoderStream }
export { createLineDecoder as createDecoderStream }

export class StreamDecoder extends HexDecoderStream {}
export class DecoderStream extends TextLineDecoderStream {}
export const createStreamDecoder = createLineDecoder
export { TextLineDecoderStream as TextLineDecoder }
export { HexDecoderStream as HexLineDecoder }
export { TextLineDecoderStream as TextStreamDecoder }

export { TextLineDecoderStream as TextDecoderStreamClass }

export { HexDecoderStream as BinaryDecoder }

export { TextLineDecoderStream as TextDecoder }

export { HexDecoderStream as ByteDecoderStream }

export class LineDecoder extends HexDecoderStream {}

export class BinaryLineDecoder extends HexDecoderStream {}

export const createBinaryDecoder = (opts?: any) => new HexDecoderStream(opts)

export const createTextLineDecoder = (opts?: any) => new TextLineDecoderStream(opts)
