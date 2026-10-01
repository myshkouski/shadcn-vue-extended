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
