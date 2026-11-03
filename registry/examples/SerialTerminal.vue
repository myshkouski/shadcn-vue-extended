<script lang="ts">
import type { TerminalTargetDevice } from '~~/registry/blocks/serial-terminal-01'
import { getRandomValues } from 'uncrypto'
import SerialTerminalBlock from '~~/registry/blocks/serial-terminal-01'
</script>

<script setup lang="ts">
import { decodeHex, decodeText } from '~~/registry/ui/serial-terminal'

abstract class VirtualDevice implements TerminalTargetDevice {
  protected _readable: ReadableStream<Uint8Array> | null = null
  protected _writable: WritableStream<Uint8Array> | null = null

  get readable() {
    return this._readable
  }

  get writable() {
    return this._writable
  }

  protected abstract _open(...args: any[]): Promise<void> | void

  async open(...args: any[]) {
    if (this.readable || this.writable)
      return

    await this._open(...args)
  }

  async close(): Promise<void> {
    const readable = this._readable
    const writable = this._writable

    this._readable = null
    this._writable = null

    await Promise.allSettled([
      readable && !readable.locked ? readable.cancel() : undefined,
      writable && !writable.locked ? writable.close() : undefined,
    ])
  }
}

class EchoTerminal extends VirtualDevice {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null

  _open() {
    this._readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller
      },
      cancel: () => {
        this.controller = null
      },
    })

    this._writable = new WritableStream(
      {
        write: (chunk) => {
          this.controller?.enqueue(new Uint8Array(chunk.buffer))
        },
      },
      {
        highWaterMark: 512,
      },
    )
  }
}

class RandomGenerator extends VirtualDevice {
  _open() {
    const byteSource = {
      type: 'bytes' as const,
      pull: async (controller: ReadableByteStreamController) => {
        const size = Math.max(1, controller.desiredSize ?? 0)
        controller.enqueue(getRandomValues(new Uint8Array(size)))
      },
    }

    this._readable = new ReadableStream(byteSource as any, {
      highWaterMark: 1024,
    })
  }
}

class GPSEmulator extends VirtualDevice {
  _open() {
    const textEncoder = new TextEncoder()
    const byteSource = {
      type: 'bytes' as const,
      pull: async (controller: ReadableByteStreamController) => {
        await new Promise(resolve => setTimeout(resolve, 1000))
        const output = [
          '$GPRMC,,V,,,,,,,,,,N*53',
          '$GPVTG,,,,,,,,,N*30',
          '$GPGGA,,,,,,0,00,99.99,,,,,,*48',
          '$GPGSA,A,1,,,,,,,,,,,,,99.99,99.99,99.99*30',
          '$GPGLL,,,,,,V,N*64',
          '',
        ].join('\r\n')
        controller.enqueue(textEncoder.encode(output))
      },
    }

    this._readable = new ReadableStream(byteSource, {
      highWaterMark: 512,
    })
  }
}

const devices = [
  {
    name: 'echo',
    title: 'Echo terminal',
    description: 'Use virtual emulated device for echoing terminal input.',
    device: new EchoTerminal(),
    encoder: decodeText,
  },
  {
    name: 'random-generator',
    title: 'Random bytes generator',
    description: 'Generates infinite random bytes, rendered as fixed length hex rows.',
    device: new RandomGenerator(),
    encoder: decodeHex,
  },
  {
    name: 'gps-emulator',
    title: 'Virtual GPS module emulator',
    description: 'Emulates output of <a class="underline" href="https://content.u-blox.com/sites/default/files/products/documents/NEO-7_DataSheet_%28UBX-13003830%29.pdf" target="_blank">u-blox NEO-7 series</a> GPS module.',
    device: new GPSEmulator(),
    encoder: decodeText,
  },
  {
    name: 'serial',
    title: 'Serial port',
    description: 'Connect to a real serial port device using <a class="underline" target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API">WebSerial API</a>.',
  },
] as const
</script>

<template>
  <SerialTerminalBlock :devices />
</template>
