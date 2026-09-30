<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import prettyBytes from 'pretty-bytes'
// import { getRandomValues } from "uncrypto"
import type { SerialTerminalTarget } from '~~/registry/ui/serial-terminal'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { CopyIcon, LinkIcon, TrashIcon } from '@lucide/vue'
import { useClipboard, watchImmediate } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'
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

const input = ref('')

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

// class RandomGenerator implements SerialTerminalTarget {
//   readonly readable = new ReadableStream<Uint8Array>({
//     pull(controller) {
//       const chunkSize = controller.desiredSize
//       console.warn("[pull]", "chunkSize:", chunkSize)
//       if (chunkSize) {
//         const chunk = getRandomValues(new Uint8Array(chunkSize))
//         controller.enqueue(chunk)
//       }
//     },
//   })

//   readonly writable = null
// }

const echoTerminalTarget = new EchoTerminal()
// const randomGenerator = new RandomGenerator()

const enableEchoTerminal = ref(true)

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const serialTerminalTarget = computed<SerialTerminalTarget | null | undefined>(() => {
  return enableEchoTerminal.value ? echoTerminalTarget : port.value
  // return randomGenerator
})

const truncated = shallowRef<number | bigint>(0n)
const { entries, append: appendOutput, clear: clearOutput } = useTerminalOutput({
  maxEntries: 100,
  onTruncate(entries) {
    for (const entry of entries) {
      if (typeof truncated.value === 'bigint') {
        truncated.value += BigInt(entry.content.length)
      }
      else {
        truncated.value += entry.content.length
      }
    }
  },
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

async function handleSend(content: string) {
  await write(textEncoder.encode(content))
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

const { copy, isSupported: isCopySupported } = useClipboard()

function copyAll() {
  if (isCopySupported.value) {
    const content = entries.value.reduce((content, entry) => {
      return content + entry.content
    }, "")
    copy(content).catch(console.error)
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
            v-if="truncated > 0"
            class="text-muted-foreground text-xs mb-2 italic"
          >
            {{ prettyBytes(truncated, { space: false }) }} truncated
          </p>

          <p v-if="!entries?.length" class="text-muted-foreground text-xs italic select-none">
            No output yet. Type a command and press Enter.
          </p>

          <SerialTerminalOutputContent :entries v-slot="{ entry }">
            <SerialTerminalOutputLine :entry />
          </SerialTerminalOutputContent>
        </SerialTerminalOutput>

        <SerialTerminalInput
          class="flex-0" 
          @send="handleSend"
        />
      </SerialTerminal>
    </div>
  </div>
</template>
