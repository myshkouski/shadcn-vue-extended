<script setup lang="ts">
/// <reference types="@types/w3c-web-serial" />

import prettyBytes from 'pretty-bytes'
// import { getRandomValues } from "uncrypto"
import type { SerialTerminalTarget } from '~~/registry/ui/serial-terminal'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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

type TerminalTargetOption = 'echo' | 'random-generator' | 'serial'
const terminalTargetOption = shallowRef<TerminalTargetOption>('echo')

const echoTerminalTarget = new EchoTerminal()
// const randomGenerator = new RandomGenerator()

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const serialTerminalTarget = computed<SerialTerminalTarget | null | undefined>(() => {
  switch (terminalTargetOption.value) {
    case 'echo':
      return echoTerminalTarget
    case 'serial':
      return port.value
    case 'random-generator':
      // not implemented
      return null
  } 
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
  { label: 'Connect', icon: LinkIcon, action: toggleConnection, disabled: 'serial' !== terminalTargetOption.value },
  { label: 'Copy', icon: CopyIcon, action: copyAll, disabled: !isCopySupported.value },
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
    title: 'Echo Terminal',
    description: 'Use virtual emulated device for echoing terminal input.',
  },
  {
    name: 'random-generator',
    title: 'Random Generator',
    description: 'Generates infinite random bytes. Not implemented yet.',
    disabled: true,
  },
  {
    name: 'serial',
    title: 'Echo Terminal',
    description: 'Connect to a real serial port device using <a class="underline" target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API">WebSerial API</a>.',
  },
]

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
