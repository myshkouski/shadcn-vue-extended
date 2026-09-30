<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import type { SerialTerminalTarget } from '~~/registry/ui/serial-terminal'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { CopyIcon, LinkIcon, TrashIcon } from '@lucide/vue'
import { useClipboard, watchImmediate } from '@vueuse/core'
import { ref, shallowRef, useTemplateRef } from 'vue'
import { useSerial } from 'vue-extras'
import { toast } from 'vue-sonner'
import { SerialTerminal, SerialTerminalHeader, useSerialTerminal } from '~~/registry/ui/serial-terminal'
import { Button } from '@/components/ui/button'

const serial = useSerial()

const input = ref('')
const serialTerminalRef = useTemplateRef('serialTerminal')

const port = shallowRef<SerialPort>()

class EchoTerminal implements SerialTerminalTarget {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null

  readonly readable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller
    },
  })

  readonly writable = new WritableStream<Uint8Array>({
    write: (chunk) => {
      this.controller?.enqueue(chunk)
    },
  })
}

const echoTerminalTarget = new EchoTerminal()

const enableEchoTerminal = ref(true)

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const serialTerminalTarget = computed<SerialTerminalTarget | null | undefined>(() => {
  return enableEchoTerminal.value ? echoTerminalTarget : port.value
})

const { write, errors, isPending: isTerminalActive } = useSerialTerminal(serialTerminalTarget, {
  onRead(data) {
    const message = textDecoder.decode(data)
    serialTerminalRef.value?.write(message, 'input')
  },
})

function isSerialPortOpen(port: SerialPort) {
  return port.readable || port.writable
}

watchImmediate([isTerminalActive, serialTerminalTarget, port], async ([isTerminalActive, target, port]) => {
  if (!isTerminalActive && port && port !== target && isSerialPortOpen(port)) {
    await port?.close()
  }
})

watchImmediate(errors, (errors) => {
  errors.forEach((error) => {
    toast.error(error.message, { dismissible: false })
  })
})

async function handleSend(payload: { content: string }) {
  const terminal = serialTerminalRef.value
  if (!terminal) {
    return
  }

  await write(textEncoder.encode(payload.content))
}

async function toggleConnection() {
  if (port.value) {
    if (isSerialPortOpen(port.value)) {
      await close()
    }
    port.value = void 0
    return
  }

  try {
    const port_ = await serial.connect({ filters: [] })

    if (!port_.readable && !port_.writable) {
      await port_.open({ baudRate: 9_600 })
    }

    port.value = port_
  }
  catch (e) {
    console.error(e)
  }
}

function clearOutput() {
  serialTerminalRef.value?.clear()
}

const { copy, isSupported: isCopySupported } = useClipboard()

function copyAll() {
  if (isCopySupported.value && serialTerminalRef.value) {
    // const content = serialTerminalRef.value
    copy('').catch(console.error)
  }
}

const buttons = computed(() => [
  { label: 'Connect', icon: LinkIcon, action: toggleConnection, disabled: enableEchoTerminal.value },
  { label: 'Copy', icon: CopyIcon, action: copyAll, disabled: !isCopySupported.value },
  { label: 'Clear', icon: TrashIcon, action: clearOutput },
])
</script>

<template>
  <div class="w-full max-w-xl space-y-4">
    <div class="flex items-start gap-2 mx-2">
      <Checkbox id="echo-mode" v-model="enableEchoTerminal" />
      <Label for="echo-mode" class="flex-col items-start gap-0">
        <span class="text-foreground">Echo Terminal</span>
        <span class="text-sm">Use virtual emulated device for echoing terminal input.</span>
      </Label>
    </div>
    <div class="h-96 overflow-hidden">
      <SerialTerminal
        ref="serialTerminal"
        v-model:input="input"
        class="size-full"
        :max-entries="20"
        @send="handleSend"
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
      </SerialTerminal>
    </div>
  </div>
</template>
