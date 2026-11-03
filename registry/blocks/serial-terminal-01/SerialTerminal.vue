<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ArrowDownIcon, CopyIcon, LinkIcon, TrashIcon, UnlinkIcon } from '@lucide/vue'
import { throttledRef, tryOnScopeDispose, useClipboard, watchImmediate } from '@vueuse/core'
import prettyBytes from 'pretty-bytes'
import { computed, onMounted, ref, shallowRef, watchEffect } from 'vue'
import { customReactive, useSerial } from 'vue-extras'
import { toast } from 'vue-sonner'
import {
  decodeText,
  SerialTerminal,
  SerialTerminalHeader,
  SerialTerminalInput,
  SerialTerminalOutput,
  SerialTerminalOutputContent,
  SerialTerminalOutputLine,
  useSerialTerminal,
  useTerminalOutput,
} from '@/components/ui/serial-terminal'
import SerialTerminalConnectDialog from './SerialTerminalConnectDialog.vue'

const props = defineProps<{
  devices?: readonly {
    name: string
    title: string
    description: string
    device?: TerminalTargetDevice
    encoder?: TerminalLineEncoder
    disabled?: boolean
  }[]
}>()

const serial = useSerial()

const input = shallowRef('')

const serialPort = ref<SerialPort>()

// Owned by the connect dialog, which is what decides when a real port is
// opened: which one, and at which speed.
const connectDialogOpen = shallowRef(false)

const terminalTargetOption = shallowRef<string>(props.devices?.[0]?.name ?? 'serial')

const textEncoder = new TextEncoder()

const encoders = computed<Record<string, TerminalLineEncoder>>(() => {
  const map: Record<string, TerminalLineEncoder> = { serial: decodeText }
  for (const d of props.devices ?? [])
    map[d.name] = d.encoder ?? decodeText
  return map
})

const encodeLine = computed(() => encoders.value[terminalTargetOption.value] ?? decodeText)

const terminalDevice = ref<TerminalTargetDevice | null | undefined>()

const reactiveDevices = new WeakMap<TerminalTargetDevice, TerminalTargetDevice>()

function toReactiveDevice(device: TerminalTargetDevice) {
  const cached = reactiveDevices.get(device)
  if (cached)
    return cached
  const proxy = customReactive(device, {
    track: ['readable', 'writable'],
    actions: { open: ['readable', 'writable'], close: ['readable', 'writable'] },
  })
  reactiveDevices.set(device, proxy)
  return proxy
}

function resolveTerminalTarget(option: string): TerminalTargetDevice | null | undefined {
  if (option === 'serial')
    return serialPort.value
  const d = (props.devices ?? []).find(x => x.name === option)
  return d?.device ? toReactiveDevice(d.device) : undefined
}

watchEffect(() => {
  const option = terminalTargetOption.value
  const target = resolveTerminalTarget(option)

  debug('computed(target)', option, '->', describeDevice(target))

  terminalDevice.value = target
})

const truncatedBytes = shallowRef<number | bigint>(0)
const throttledTruncatedBytes = throttledRef(truncatedBytes, 1_000, true)
const {
  entries,
  append: appendOutput,
  clear: clearOutput,
} = useTerminalOutput({
  maxBytes: 16 * 1_024,
  maxLineBytes: 512,
  encode: encodeLine,
  onTruncate(bytes) {
    truncatedBytes.value = BigInt(truncatedBytes.value) + BigInt(bytes)
  },
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

    if (typeof device?.open === 'function')
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

function clearOutputAndTruncatedBytesCounter() {
  clearOutput()
  truncatedBytes.value = 0
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
    { label: 'Clear', icon: TrashIcon, action: clearOutputAndTruncatedBytesCounter },
  ]
})

const targetOptions = computed<TargetOptions[]>(() => {
  const options: TargetOptions[] = (props.devices ?? []).map(d => ({
    name: d.name,
    title: d.title,
    description: d.description,
    disabled: d.disabled,
  }))
  return options
})

function hasEntries() {
  // The line being written to is the last entry: without it the
  // placeholder would flash for as long as the first line takes to
  // arrive.
  return !!toValue(entries)[Symbol.iterator]().next().value
}

const terminalStateText = computed(() => {
  return Object.entries({
    r: serialTerminalState.value.readable,
    w: serialTerminalState.value.writable,
  }).reduce((text, [char, enabled]) => {
    if (enabled)
      text += char
    return text
  }, '')
})

const isFollowingOutput = shallowRef(true)
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

        <div class="relative flex-1 overflow-hidden">
          <SerialTerminalOutput class="h-full">
            <p
              v-if="throttledTruncatedBytes > 0"
              class="p-4 text-muted-foreground/50 text-xs italic"
            >
              {{ prettyBytes(throttledTruncatedBytes, { space: false }) }} truncated
            </p>

            <p v-if="!hasEntries()" class="p-4 text-muted-foreground text-xs italic select-none">
              No output yet. Type a command and press Enter.
            </p>

            <SerialTerminalOutputContent
              v-slot="{ entry }"
              v-model:follow="isFollowingOutput"
              :entries
            >
              <SerialTerminalOutputLine :entry />
            </SerialTerminalOutputContent>
          </SerialTerminalOutput>

          <Button
            v-show="!isFollowingOutput"
            class="absolute bottom-4 right-4"
            variant="outline"
            size="icon"
            aria-label="Follow output"
            @click="isFollowingOutput = true"
          >
            <ArrowDownIcon />
          </Button>
        </div>

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
import type { TerminalLineEncoder } from '@/components/ui/serial-terminal'
import type { SerialTerminalConnectPayload, SerialTerminalPortOption, SerialTerminalRequestPortPayload } from './SerialTerminalConnectDialog.vue'
import type { TerminalTargetDevice } from './types.ts'
import { describeDevice, describePort } from './utils.ts'

// --- debug ------------------------------------------------------------------

// Single entry point for the debug trail, so it is greppable in the console and
// trivial to strip before this example goes anywhere near a release.
// eslint-disable-next-line no-console
const debug = (...args: unknown[]) => console.debug('[serial-terminal]', ...args)

// --- types ------------------------------------------------------------------

interface TargetOptions {
  name: string
  title: string
  description: string
  disabled?: boolean
}

function isDeviceOpen(device: TerminalTargetDevice) {
  return device.readable || device.writable
}
</script>
