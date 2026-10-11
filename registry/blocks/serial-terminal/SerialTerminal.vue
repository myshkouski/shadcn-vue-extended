<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { CopyIcon, LinkIcon, TrashIcon, UnlinkIcon } from '@lucide/vue'
import { tryOnScopeDispose, useClipboard, watchImmediate } from '@vueuse/core'
import prettyBytes from 'pretty-bytes'
import { computed, onMounted, ref, shallowRef, toRaw, watchEffect } from 'vue'
import { customReactive, useSerial } from 'vue-extras'
import { toast } from 'vue-sonner'
import {
  decodeHex,
  decodeText,
  SerialTerminal,
  SerialTerminalHeader,
  SerialTerminalInput,
  SerialTerminalOutput,
  SerialTerminalOutputContent,
  SerialTerminalOutputLine,
  useSerialTerminal,
  useTerminalOutput,
} from '~~/registry/ui/serial-terminal'
import SerialTerminalConnectDialog from './SerialTerminalConnectDialog.vue'

const serial = useSerial()

const input = shallowRef('')

const serialPort = ref<SerialPort>()

// Owned by the connect dialog, which is what decides when a real port is
// opened: which one, and at which speed.
const connectDialogOpen = shallowRef(false)

const terminalTargetOption = shallowRef<TerminalTargetOption>('echo')

// How a device's bytes become the text of a line: the terminal talks text, so
// echo, GPS and a real port render as-is, while the random generator emits bytes
// that only make sense as fixed length hex rows. Lines are rendered as they are
// written, so switching the option applies to what comes next and leaves the
// lines already on screen as they were.
const encoders: Record<TerminalTargetOption, TerminalLineEncoder> = {
  'echo': decodeText,
  'gps-emulator': decodeText,
  'serial': decodeText,
  'random-generator': decodeHex,
}

const encodeLine = computed(() => encoders[terminalTargetOption.value])

// Since terminalTargetOption would be reactive, target should be deeply watched ref to track its props
const terminalDevice = ref<TerminalTargetDevice | null | undefined>()

/* eslint-disable ts/no-use-before-define -- devices are declared in the trailing <script> block */
const echoTerminalTarget = new EchoTerminal()
const randomGenerator = new RandomGenerator()
const gpsEmulator = new GPSEmulator()

const textEncoder = new TextEncoder()

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

const {
  entries,
  truncatedBytes,
  append: appendOutput,
  clear: clearOutput,
} = useTerminalOutput({
  maxBytes: 2_048,
  maxLineBytes: 128,
  encode: encodeLine,
})

const {
  write,
  errors,
  stop: stopTerminal,
  state: serialTerminalState,
} = useSerialTerminal(terminalDevice, {
  // The bytes go to the buffer as they arrived: the encoder decides how a line
  // of them reads, and keeps the line breaks for text devices so that copying
  // the output gives the stream back.
  onRead(data) {
    appendOutput(data, 'input')
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

async function connect() {
  try {
    const device = terminalDevice.value

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

// The ports the browser already knows about: `useSerial` keeps the list from
// `getPorts()`, which only holds devices the user granted before. A port seen
// here can be opened without asking for permission again.
const serialPortOptions = computed<SerialTerminalPortOption[]>(() => serial.ports.value.map(describePort))

async function handleConnect({ portKey, baudRate }: SerialTerminalConnectPayload) {
  try {
    const port = serial.ports.value[Number(portKey)]

    if (!port)
      return

    debug('openSerialPort', { baudRate, port: portKey })

    // Already open: `open()` would throw, and the streams it exposes are the
    // ones the reader wants anyway.
    if (!port.readable && !port.writable)
      await port.open({ baudRate })

    // Drives `terminalDevice` through the `watchEffect` above.
    serialPort.value = port
    connectedTarget.value = port

    connectDialogOpen.value = false
  }
  catch (e) {
    console.error(e)
  }
}

// The separate button in the dialog: this click is the user gesture the
// browser requires to show its device picker, so the request has to run
// straight from it.
async function handleRequestPort({ baudRate }: SerialTerminalRequestPortPayload) {
  try {
    const port = await serial.connect({ filters: [] })

    if (!port)
      return

    debug('requestPort', { baudRate })

    if (!port.readable && !port.writable)
      await port.open({ baudRate })

    serialPort.value = port
    connectedTarget.value = port

    connectDialogOpen.value = false
  }
  catch (e) {
    console.error(e)
  }
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
    // Every line the buffer holds, the one still being written to
    // included: it is the last element, and dropping it would cut the
    // stream short.
    for (const entry of toValue(entries))
      content += entry.content

    copy(content).catch(console.error)
  }
}

const buttons = computed(() => {
  debug('computed(buttons)', {
    terminalTargetOption: terminalTargetOption.value,
    isConnected: isConnected.value,
    isSerialSupported: isSerialSupported.value,
    isCopySupported: isCopySupported.value,
  })

  return [
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
    description: 'Generates infinite random bytes, rendered as fixed length hex rows.',
    // disabled: true,
  },
  {
    name: 'gps-emulator',
    title: 'Virtual GPS module emulator',
    description: 'Emulates output of <a class="underline" href="https://content.u-blox.com/sites/default/files/products/documents/NEO-7_DataSheet_%28UBX-13003830%29.pdf" target="_blank">u-blox NEO-7 series</a> GPS module.',
  },
  {
    name: 'serial',
    title: 'Serial port',
    description: 'Connect to a real serial port device using <a class="underline" target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API">WebSerial API</a>.',
  },
]

function hasEntries() {
  // The line being written to is the last entry: without it the
  // placeholder would flash for as long as the first line takes to
  // arrive.
  return !!toValue(entries)[Symbol.iterator]().next().value
}

const terminalStateText = computed(() => {
  return Object.entries({
    'r': serialTerminalState.value.readable,
    'w': serialTerminalState.value.writable,
  }).reduce((text, [char, enabled]) => {
    if (enabled) text += char
    return text
  }, '')
})
</script>

<template>
  <div class="w-full max-w-xl space-y-8">
    <div class="space-y-2">
      <p>Select terminal device:</p>
      <RadioGroup v-model="terminalTargetOption">
        <div
          v-for="{ name, title, description, disabled } in targetOptions"
          :key="name"
          class="flex items-start space-x-2"
        >
          <RadioGroupItem :id="`device-${name}`" :disabled="disabled" :value="name" />
          <Label
            :for="`device-${name}`"
            class="flex-col items-start gap-0"
            :class="[
              { 'opacity-50': disabled },
            ]"
          >
            <span class="text-foreground">{{ title }}</span>
            <span class="text-sm" v-html="description" />
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
          <span class="text-xs">{{ terminalStateText }}</span>
          <!--
            Only a real port has to be picked and configured: the dialog lists
            the ports the browser already knows about and the baud rate to open
            one with. The emulators have neither, so their connect button opens
            them straight away.
          -->
          <SerialTerminalConnectDialog
            v-if="'serial' === terminalTargetOption && !isConnected"
            v-model:open="connectDialogOpen"
            :ports="serialPortOptions"
            allow-request-port
            @connect="handleConnect"
            @request-port="handleRequestPort"
          >
            <template #trigger>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Connect"
                :disabled="!isSerialSupported"
              >
                <LinkIcon class="size-3" />
              </Button>
            </template>
          </SerialTerminalConnectDialog>

          <Button
            v-else-if="!isConnected"
            variant="ghost"
            size="sm"
            aria-label="Connect"
            @click="connect"
          >
            <LinkIcon class="size-3" />
          </Button>

          <Button
            v-if="isConnected"
            variant="ghost"
            size="sm"
            aria-label="Disconnect"
            @click="disconnect"
          >
            <UnlinkIcon class="size-3" />
          </Button>

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

          <SerialTerminalOutputContent
            v-slot="{ entry }"
            :entries
          >
            <SerialTerminalOutputLine :entry />
          </SerialTerminalOutputContent>
        </SerialTerminalOutput>

        <SerialTerminalInput
          class="flex-0"
          placeholder="Enter command"
          :disabled="!serialTerminalState.writable"
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
import type { SerialTerminalTarget, TerminalLineEncoder } from '~~/registry/ui/serial-terminal'
import type { SerialTerminalConnectPayload, SerialTerminalPortOption, SerialTerminalRequestPortPayload } from './SerialTerminalConnectDialog.vue'
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

interface TargetOptions {
  name: TerminalTargetOption
  title: string
  description: string
  disabled?: boolean
}

interface TerminalTargetDevice extends SerialTerminalTarget {
  open: (...args: any[]) => Promise<void> | void
  close: () => Promise<void> | void
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

function readPortInfo(port: SerialPort): SerialPortInfo {
  // Only exposed to a granted port, so a device can refuse it.
  try {
    return port.getInfo()
  }
  catch {
    return {}
  }
}

function describePort(port: SerialPort, index: number): SerialTerminalPortOption {
  const { usbVendorId, usbProductId } = readPortInfo(port)
  const ids = [usbVendorId, usbProductId]
    .filter((id): id is number => typeof id === 'number')
    .map(id => id.toString(16).padStart(4, '0'))
  const isOpen = !!port.readable || !!port.writable

  return {
    // `SerialPort` carries no id of its own, and its USB ids collide between two
    // identical devices. The position in the list is the one handle that stays
    // unique, and it is exactly what `handleConnect` resolves against.
    key: String(index),
    label: ids.length ? `USB ${ids.join(':')}` : `Serial port ${index + 1}`,
    description: isOpen ? 'Already open' : 'Available',
    open: isOpen,
  }
}

function describeDevice(device: TerminalTargetDevice | null | undefined): string {
  if (!device)
    return String(device)
  const raw = untrackDevice(device)
  return `${Object.getPrototypeOf(raw).constructor.name} { readable: ${describeStream(raw.readable)}, writable: ${describeStream(raw.writable)} }`
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
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
  readonly type = 'bytes'

  private cancelled = false

  constructor(
    private readonly read: (chunkSize: number) => PromiseLike<ArrayBufferView<ArrayBuffer>> | ArrayBufferView<ArrayBuffer>,
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

  protected abstract _open(...args: any[]): Promise<void> | void

  async open(...args: any[]) {
    if (this.readable || this.writable)
      return
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

    this._writable = new WritableStream(
      {
        write: (chunk) => {
          this.controller?.enqueue(new Uint8Array(chunk.buffer))
        },
      },
      {
        highWaterMark: 512,
      }
    )
  }
}

class RandomGenerator extends VirtualDevice {
  _open() {
    const byteSource = new DefaultUnderlyingByteSource(async (size) => {
      return getRandomValues(new Uint8Array(size))
    })
    this._readable = new ReadableStream(
      byteSource,
      {
        highWaterMark: 1024,
      }
    )
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
        '',
      ].join('\r\n')

      return textEncoder.encode(output)
    })

    this._readable = new ReadableStream(
      byteSource, 
      {
        highWaterMark: 512,
      }
    )
  }
}
</script>
