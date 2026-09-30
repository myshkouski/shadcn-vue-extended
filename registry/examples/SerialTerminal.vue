<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import prettyBytes from 'pretty-bytes'
import { getRandomValues } from "uncrypto"
import type { SerialTerminalTarget } from '~~/registry/ui/serial-terminal'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { CopyIcon, LinkIcon, TrashIcon } from '@lucide/vue'
import { useClipboard, watchImmediate } from '@vueuse/core'
import { computed, shallowRef, onBeforeMount } from 'vue'
import { useSerial } from 'vue-extras'
import { toast } from 'vue-sonner'
import {
  SerialTerminal, 
  SerialTerminalHeader, 
  SerialTerminalOutput,
  SerialTerminalOutputLine,
  SerialTerminalOutputContent,
  SerialTerminalInput,
  useSerialTerminal,
  useTerminalOutput,
} from '~~/registry/ui/serial-terminal'
import { Button } from '@/components/ui/button'

const serial = useSerial()

const input = shallowRef('')

interface TerminalTargetDevice extends SerialTerminalTarget {
  open(...args: any[]): Promise<void> | void;
  close(): Promise<void> | void;
}

abstract class GenericTerminalTargetDevice implements TerminalTargetDevice {
  protected _readable: ReadableStream<Uint8Array> | null = null
  protected _writable: WritableStream<Uint8Array> | null = null

  get readable() {
    return this._readable
  }

  get writable() {
    return this._writable
  }

  protected abstract _open(...args: any[]): Promise<void> | void;

  async open(...args: any[]) {
    if (this.readable || this.writable) return
    return await this._open(...args)
  }

  async close(): Promise<void> {
    await this._readable?.cancel()
    await this._writable?.close()
  }
}

class DefaultUnderlyingByteSource implements UnderlyingByteSource {
  readonly type = 'bytes';

  constructor(
    private readonly read: (chunkSize: number) => PromiseLike<ArrayBufferView<ArrayBuffer>> | ArrayBufferView<ArrayBuffer>
  ) {}
  
  async pull(controller: ReadableByteStreamController): Promise<void> {
    const chunkSize = controller.desiredSize ?? 0
    if (chunkSize <= 0) {
      const buffer = await this.read(chunkSize)
      controller.enqueue(buffer)
    }
  }
}

const terminalDevice = shallowRef<TerminalTargetDevice>()

class EchoTerminal extends GenericTerminalTargetDevice {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null

  _open() {
    this._readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller
      },
    })

    this._writable = new WritableStream({
      write: (chunk) => {
        this.controller?.enqueue(chunk)
      },
    })
  }
}

class RandomGenerator extends GenericTerminalTargetDevice {
  _open() {
    const byteSource = new DefaultUnderlyingByteSource((size) => {
      return getRandomValues(new Uint8Array(size))
    })
    this._readable = new ReadableStream(byteSource, {
      highWaterMark: 256,
    })
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => { resolve() }, ms)
  })
}

class GPSEmulator extends GenericTerminalTargetDevice {
  _open() {
    const textEncoder = new TextEncoder()
    const byteSource = new DefaultUnderlyingByteSource(async (_size) => {
      await delay(1_000)

      const output = [
        '$GPRMC,,V,,,,,,,,,,N*53',
        '$GPVTG,,,,,,,,,N*30',
        '$GPGGA,,,,,,0,00,99.99,,,,,,*48',
        '$GPGSA,A,1,,,,,,,,,,,,,99.99,99.99,99.99*30',
        '$GPGLL,,,,,,V,N*64',
        ''
      ].join('\r\n')

      return textEncoder.encode(output)
    })

    this._readable = new ReadableStream(byteSource, {
      highWaterMark: 512,
    })
  }
}

type TerminalTargetOption = 
  | 'echo' 
  | 'random-generator' 
  | 'gps-emulator' 
  | 'serial'

const terminalTargetOption = shallowRef<TerminalTargetOption>('echo')

const echoTerminalTarget = new EchoTerminal()
const randomGenerator = new RandomGenerator()
const gpsEmulator = shallowRef<GPSEmulator>()
onMounted(() => {
  gpsEmulator.value = new GPSEmulator()
})

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const serialTerminalTarget = computed<SerialTerminalTarget | null | undefined>(() => {
  switch (terminalTargetOption.value) {
    case 'echo':
      return echoTerminalTarget
    case 'serial':
      return terminalDevice.value
    case 'gps-emulator':
      return gpsEmulator.value
    case 'random-generator':
      return randomGenerator
  } 
})

const { entries, truncatedBytes, append: appendOutput, clear: clearOutput } = useTerminalOutput({
  maxBytes: 8 * 1024,
  maxLineBytes: 128,
})

const {
  write,
  errors,
  isPending: isTerminalActive,
} = useSerialTerminal(serialTerminalTarget, {
  onRead(data) {
    const message = textDecoder.decode(data)
    appendOutput(message, 'input')
  },
})

function isDeviceOpen(device: TerminalTargetDevice) {
  return device.readable || device.writable
}

watchImmediate([isTerminalActive, serialTerminalTarget, terminalDevice], async ([isTerminalActive, target, terminalDevice]) => {
  if (!isTerminalActive && terminalDevice && terminalDevice !== target && isDeviceOpen(terminalDevice)) {
    await terminalDevice?.close()
  }
})

watchImmediate(errors, (errors) => {
  errors.forEach((error) => {
    toast.error(error.message, { dismissible: false })
  })
})

async function handleSend(content: string) {
  await write(textEncoder.encode(content))
}

async function toggleConnection() {
  if (terminalDevice.value) {
    if (isDeviceOpen(terminalDevice.value)) {
      await close()
    }
    terminalDevice.value = void 0
    return
  }

  try {
    const port_ = await serial.connect({ filters: [] })

    if (!port_.readable && !port_.writable) {
      await port_.open({ baudRate: 9_600 })
    }

    terminalDevice.value = port_
  }
  catch (e) {
    console.error(e)
  }
}

const { copy, isSupported: _isCopySupported } = useClipboard()
// hydration mismatch workaround
const isCopySupported = shallowRef(false)
onBeforeMount(() => {
  isCopySupported.value = _isCopySupported.value
})

function copyOutput() {
  if (isCopySupported.value) {
    let content = ''
    for (const entry of entries.value) {
      content += entry.content
    }
    copy(content).catch(console.error)
  }
}

const buttons = computed(() => [
  { label: 'Connect', icon: LinkIcon, action: toggleConnection, disabled: 'serial' !== terminalTargetOption.value },
  { label: 'Copy', icon: CopyIcon, action: copyOutput, disabled: !isCopySupported.value },
  { label: 'Clear', icon: TrashIcon, action: clearOutput },
])

type TargetOptions = {
  name: TerminalTargetOption;
  title: string
  description: string
  disabled?: boolean
}

const targetOptions: readonly TargetOptions[] = [
  {
    name: 'echo',
    title: 'Echo terminal',
    description: 'Use virtual emulated device for echoing terminal input.',
  },
  {
    name: 'random-generator',
    title: 'Random bytes generator',
    description: 'Generates infinite random bytes. Not implemented yet.',
    // disabled: true,
  },
  {
    name: 'gps-emulator',
    title: 'Virtual GPS module emulator',
    description: 'Emulates output of the <a class="underline" href="https://content.u-blox.com/sites/default/files/products/documents/NEO-7_DataSheet_%28UBX-13003830%29.pdf" target="_blank">NEO-7</a> GPS module',
  },
  {
    name: 'serial',
    title: 'Serial port',
    description: 'Connect to a real serial port device using <a class="underline" target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API">WebSerial API</a>.',
  },
]

function hasEntries() {
  for (const _ of entries.value) {
    return true
  }
  return false
}

</script>

<template>
  <div class="w-full max-w-xl space-y-8">
    <div class="space-y-2">
      <p>Select terminal device:</p>
      <RadioGroup v-model="terminalTargetOption">
        <div
          v-for="{ name, title, description, disabled } in targetOptions" 
          class="flex items-start space-x-2"
        >
          <RadioGroupItem :disabled="disabled" id="r1" :value="name" />
          <Label for="echo" :class="[
            'flex-col items-start gap-0',
            { 'opacity-50': disabled },
          ]">
            <span class="text-foreground">{{ title }}</span>
            <span class="text-sm" v-html="description"></span>
          </Label>
        </div>
      </RadioGroup>
    </div>
    <div class="h-96 overflow-hidden">
      <SerialTerminal
        v-model:input="input"
        class="size-full"
      >
        <SerialTerminalHeader>
          <Button
            v-for="(item, index) in buttons"
            :key="index"
            variant="ghost"
            size="sm"
            :aria-label="item.label"
            :disabled="item.disabled"
            @click="item.action"
          >
            <component :is="item.icon" class="size-3" />
          </Button>
        </SerialTerminalHeader>

        <SerialTerminalOutput class="flex-1">
          <p
            v-if="truncatedBytes > 0"
            class="p-4 text-muted-foreground/50 text-xs italic"
          >
            {{ prettyBytes(truncatedBytes, { space: false }) }} truncated
          </p>

          <p v-if="!hasEntries()" class="p-4 text-muted-foreground text-xs italic select-none">
            No output yet. Type a command and press Enter.
          </p>

          <SerialTerminalOutputContent :entries v-slot="{ entry }">
            <SerialTerminalOutputLine :entry />
          </SerialTerminalOutputContent>
        </SerialTerminalOutput>

        <SerialTerminalInput
          class="flex-0"
          placeholder="Enter command"
          @send="handleSend"
        />
      </SerialTerminal>
    </div>
  </div>
</template>
