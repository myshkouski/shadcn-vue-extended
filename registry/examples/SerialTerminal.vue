<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import prettyBytes from 'pretty-bytes'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { CopyIcon, LinkIcon, TrashIcon, UnlinkIcon } from '@lucide/vue'
import { tryOnScopeDispose, useClipboard, watchImmediate } from '@vueuse/core'
import { computed, ref, shallowRef, toRaw, watchEffect, onMounted } from 'vue'
import { customReactive, useSerial } from 'vue-extras'
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

const serialPort = ref<SerialPort>()

const terminalTargetOption = shallowRef<TerminalTargetOption>('echo')

// Since terminalTargetOption would be reactive, target should be deeply watched ref to track its props
const terminalDevice = ref<TerminalTargetDevice | null | undefined>()

/* eslint-disable ts/no-use-before-define -- devices are declared in the trailing <script> block */
const echoTerminalTarget = new EchoTerminal()
const randomGenerator = new RandomGenerator()
const gpsEmulator = new GPSEmulator()

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function resolveTerminalTarget(option: TerminalTargetOption): TerminalTargetDevice | null | undefined {
  switch (option) {
    case 'serial':
      return serialPort.value
    case 'echo':
      return toReactiveDevice(echoTerminalTarget)
    case 'gps-emulator':
      return toReactiveDevice(gpsEmulator)
    case 'random-generator':
      return toReactiveDevice(randomGenerator)
  }
}

watchEffect(() => {
  const option = terminalTargetOption.value
  const target = resolveTerminalTarget(option)

  debug('computed(target)', option, '->', describeDevice(target))

  terminalDevice.value = target
})

const { entries, truncatedBytes, append: appendOutput, clear: clearOutput } = useTerminalOutput({
  maxBytes: 8 * 1024,
  maxLineBytes: 128,
})

const {
  write,
  errors,
  stop: stopTerminal,
} = useSerialTerminal(terminalDevice, {
  onRead(data) {
    const message = textDecoder.decode(data)
    appendOutput(message, 'input')
  },
})

// The device currently attached, which is not the same thing as the selected
// one: selecting an emulator leaves it closed until it is connected.
//
// Deliberately not derived from `readable`/`writable`: the emulators track those
// through `customReactive`, but a `SerialPort` is a host object Vue cannot
// proxy, so a computed over them would only ever update for the emulators.
const connectedTarget = shallowRef<TerminalTargetDevice | undefined>()

const isConnected = computed(() => !!connectedTarget.value)

// Selecting a device never starts it. The Connect button owns that lifecycle,
// so switching options does not begin streaming on its own.
//
// Tearing the replaced target down lives here, in the watcher that knows the
// real `oldTarget`. A separate watcher that reads the old device would subscribe
// to the reactive props `close()` itself triggers, re-enter with a stale
// `oldTarget` and cancel the stream the reader has just locked.
watchImmediate(terminalDevice, async (target, oldTarget) => {
  debug('watch(target)', describeDevice(oldTarget), '->', describeDevice(target))

  if (!oldTarget || oldTarget === target)
    return

  if (oldTarget === connectedTarget.value) {
    debug('watch(target) disconnecting', describeDevice(oldTarget))
    connectedTarget.value = void 0
  }

  if (isDeviceOpen(oldTarget)) {
    debug('watch(target) closing', describeDevice(oldTarget))
    await oldTarget.close()
  }
})

tryOnScopeDispose(async () => {
  await terminalDevice.value?.close()
})

let seenErrorMessages = new Set<string>()

watchImmediate(errors, (errors, oldErrors) => {
  debug('watch(errors)', {
    errors: errors.map(error => error.message),
    previous: oldErrors?.map(error => error.message) ?? [],
  })

  const messages = new Set(errors.map(error => error.message))

  for (const message of messages) {
    // Repeats of a message already on screen would stack up undismissable
    // toasts, so only the first occurrence of a given failure is announced.
    if (seenErrorMessages.has(message)) {
      continue
    }
    toast.error(message, { dismissible: false, duration: 5_000 })
  }

  seenErrorMessages = messages
})

async function handleSend(content: string) {
  await write(textEncoder.encode(content)).catch(console.error)
}

async function toggleConnection() {
  if (isConnected.value) {
    await disconnect()
    return
  }

  await connect()
}

async function connect() {
  try {
    const device = 'serial' === terminalTargetOption.value
      ? await openSerialPort()
      : terminalDevice.value

    if (!device)
      return

    if (device instanceof VirtualDevice)
      await device.open()

    debug('connect', describeDevice(device))
    connectedTarget.value = device
  }
  catch (e) {
    console.error(e)
  }
}

async function openSerialPort() {
  const port_ = await serial.connect({ filters: [] })

  if (!port_.readable && !port_.writable) {
    await port_.open({ baudRate: 9_600 })
  }

  // Drives `terminalDevice` through the `watchEffect` above.
  serialPort.value = port_

  return port_
}

async function disconnect() {
  const device = connectedTarget.value

  connectedTarget.value = void 0

  if (!device)
    return

  // Unconditional rather than gated on "is the terminal busy": a read-only
  // emulator has no writer, so that flag reads false for it while its reader
  // still holds the lock `close()` needs released.
  stopTerminal()

  try {
    if (isDeviceOpen(device))
      await device.close()
  }
  catch (e) {
    console.error(e)
  }

  debug('disconnect', describeDevice(device))

  // Drops `terminalDevice` through the `watchEffect` above.
  if (device === serialPort.value)
    serialPort.value = void 0
}

const { copy, isSupported: _isCopySupported } = useClipboard()
// Browser-only APIs, so the server render must keep the pessimistic `false`
// that the client also produces on its first render. `onMounted` runs *after*
// the initial render; `onBeforeMount` would run before it and desync the two.
const isCopySupported = shallowRef(false)
onMounted(() => {
  isCopySupported.value = _isCopySupported.value
})

// Same reasoning: `navigator.serial` only exists on the client.
const isSerialSupported = shallowRef(false)
onMounted(() => {
  isSerialSupported.value = serial.isSupported.value
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

const buttons = computed(() => {
  const isSerialSelected = 'serial' === terminalTargetOption.value
  const isConnectedNow = isConnected.value

  debug('computed(buttons)', {
    terminalTargetOption: terminalTargetOption.value,
    isConnected: isConnectedNow,
    isSerialSupported: isSerialSupported.value,
    isCopySupported: isCopySupported.value,
  })

  return [
    {
      label: isConnectedNow ? 'Disconnect' : 'Connect',
      icon: isConnectedNow ? UnlinkIcon : LinkIcon,
      action: toggleConnection,
      // A serial port can only be picked from a user gesture, and only where the
      // browser exposes the API at all.
      disabled: isSerialSelected && !isSerialSupported.value,
    },
    { label: 'Copy', icon: CopyIcon, action: copyOutput, disabled: !isCopySupported.value },
    { label: 'Clear', icon: TrashIcon, action: clearOutput },
  ]
})

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
    description: 'Emulates output of the <a class="underline" href="https://content.u-blox.com/sites/default/files/products/documents/NEO-7_DataSheet_%28UBX-13003830%29.pdf" target="_blank">u-blox NEO-7 series</a> GPS module',
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

<!--
  Mock devices, utilities and types live here instead of in `<script setup>` so
  the setup block above stays about wiring: state, watchers and handlers.

  A Vue SFC accepts at most one `<script>` and one `<script setup>` block, so
  this cannot be split further into one tag per class without moving the mocks
  into their own files.
-->
<!-- eslint-disable vue/block-order -->
<script lang="ts">
/* eslint-disable import/first -- imports are hoisted per block, the mocks only need the shared module scope */
import type { SerialTerminalTarget } from '~~/registry/ui/serial-terminal'
import { getRandomValues } from 'uncrypto'

// --- debug ------------------------------------------------------------------

// Single entry point for the debug trail, so it is greppable in the console and
// trivial to strip before this example goes anywhere near a release.
// eslint-disable-next-line no-console
const debug = (...args: unknown[]) => console.debug('[serial-terminal]', ...args)

// --- types ------------------------------------------------------------------

type TerminalTargetOption =
  | 'echo'
  | 'random-generator'
  | 'gps-emulator'
  | 'serial'

type TargetOptions = {
  name: TerminalTargetOption;
  title: string
  description: string
  disabled?: boolean
}

interface TerminalTargetDevice extends SerialTerminalTarget {
  open(...args: any[]): Promise<void> | void;
  close(): Promise<void> | void;
}

// --- utils ------------------------------------------------------------------

// `customReactive` tracks `readable`/`writable`, so reading them through its
// proxy inside a watcher subscribes that watcher to the device. Inspecting a
// device must not do that: `close()` triggers exactly these props, which would
// re-enter the watcher with a stale `oldTarget`. `toRaw` unwraps the proxy
// (its `get` handler answers `ReactiveFlags.RAW`) and makes the read inert.
// `customReactive` tracks `readable`/`writable`, so reading them through its
// proxy inside a watcher subscribes that watcher to the device. Inspecting a
// device must not do that: `close()` triggers exactly these props, which would
// re-enter the watcher with a stale `oldTarget`. `toRaw` unwraps the proxy
// (its `get` handler answers `ReactiveFlags.RAW`) and makes the read inert.
// `customReactive` tracks `readable`/`writable`, so reading them through its
// proxy inside a watcher subscribes that watcher to the device. Inspecting a
// device must not do that: `close()` triggers exactly these props, which would
// re-enter the watcher with a stale `oldTarget` and cancel the stream the reader
// has just locked. `toRaw` unwraps the proxy (its `get` handler answers
// `ReactiveFlags.RAW`) and makes the read inert.
function untrackDevice(device: TerminalTargetDevice): TerminalTargetDevice {
  return toRaw(device)
}

function isDeviceOpen(device: TerminalTargetDevice) {
  const raw = untrackDevice(device)
  return raw.readable || raw.writable
}

function describeStream(stream: ReadableStream<Uint8Array> | WritableStream<Uint8Array> | null | undefined): string {
  if (!stream)
    return 'none'
  return stream.locked ? 'locked' : 'unlocked'
}

function describeDevice(device: TerminalTargetDevice | null | undefined): string {
  if (!device)
    return String(device)
  const raw = untrackDevice(device)
  return `${Object.getPrototypeOf(raw).constructor.name} { readable: ${describeStream(raw.readable)}, writable: ${describeStream(raw.writable)} }`
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => { resolve() }, ms)
  })
}

// Same device instance must keep yielding the same proxy: `resolveTerminalTarget`
// runs on every `watchEffect` pass, and a fresh proxy per call would look like a
// different target to the reader, which would then `getReader()` an already
// locked stream.
const reactiveDevices = new WeakMap<TerminalTargetDevice, TerminalTargetDevice>()

function toReactiveDevice(device: TerminalTargetDevice) {
  const cached = reactiveDevices.get(device)

  if (cached)
    return cached

  const proxy = customReactive(device, {
    track: ['readable', 'writable'],
    actions: {
      open: ['readable', 'writable'],
      close: ['readable', 'writable'],
    },
  })

  reactiveDevices.set(device, proxy)

  return proxy
}

// --- byte stream source -----------------------------------------------------

class DefaultUnderlyingByteSource implements UnderlyingByteSource {
  readonly type = 'bytes';

  private cancelled = false

  constructor(
    private readonly read: (chunkSize: number) => PromiseLike<ArrayBufferView<ArrayBuffer>> | ArrayBufferView<ArrayBuffer>
  ) {}

  async pull(controller: ReadableByteStreamController): Promise<void> {
    if (this.cancelled) {
      return
    }

    // `pull` gets scheduled again on every microtask while a read is pending,
    // even once the queue is full, so returning without enqueueing would spin
    // the microtask queue forever. Always hand over at least one byte and let
    // `desiredSize` size the chunk, not gate it.
    const chunkSize = Math.max(1, controller.desiredSize ?? 0)
    const buffer = await this.read(chunkSize)

    // Cancelling closes the stream, and `enqueue` on a closed stream throws.
    if (this.cancelled) {
      return
    }

    controller.enqueue(buffer)
  }

  cancel() {
    this.cancelled = true
  }
}

// --- virtual devices --------------------------------------------------------

abstract class VirtualDevice implements TerminalTargetDevice {
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
    debug('VirtualDevice#open', 'before open', this)
    await this._open(...args)
    debug('VirtualDevice#open', 'opened', this)
  }

  async close(): Promise<void> {
    debug('VirtualDevice#close', 'before close', this)

    const readable = this._readable
    const writable = this._writable

    // Cleared up front so `close()` is idempotent and `open()` can build a
    // fresh pair of streams.
    this._readable = null
    this._writable = null

    // A locked stream rejects `cancel()`/`close()` outright. Releasing a lock
    // belongs to whoever holds it, and that consumer may not have detached yet,
    // so skip the teardown instead of failing on it.
    if (readable?.locked)
      debug('VirtualDevice#close', 'skipped locked readable')
    if (writable?.locked)
      debug('VirtualDevice#close', 'skipped locked writable')

    await Promise.allSettled([
      readable && !readable.locked ? readable.cancel() : undefined,
      writable && !writable.locked ? writable.close() : undefined,
    ])

    debug('VirtualDevice#close', 'closed', this)
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

    this._writable = new WritableStream({
      write: (chunk) => {
        this.controller?.enqueue(chunk)
      },
    })
  }
}

class RandomGenerator extends VirtualDevice {
  _open() {
    const byteSource = new DefaultUnderlyingByteSource(async (size) => {
      // Without a tick of its own this produces as fast as the event loop can
      // turn, which starves rendering instead of stressing the output buffer.
      await delay(16)
      return getRandomValues(new Uint8Array(size))
    })
    this._readable = new ReadableStream(byteSource, {
      highWaterMark: 256,
    })
  }
}

class GPSEmulator extends VirtualDevice {
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
</script>
