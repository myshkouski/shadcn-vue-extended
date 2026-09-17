<script setup lang="ts">

/// <reference types="@types/w3c-web-serial" />

import { Button } from "~/components/ui/button"
import { TrashIcon, LinkIcon } from "@lucide/vue"
import { ref } from 'vue'
import { SerialTerminal, SerialTerminalHeader, useTerminalReader, useTerminalWriter } from '~~/registry/ui/serial-terminal'

const port = shallowRef<SerialPort | null>()
const readable = computed(() => {
  return port.value?.readable as ReadableStream<Uint8Array> | null
})
const writable = computed(() => {
  return port.value?.writable as WritableStream<Uint8Array> | null
})

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const { error: readError, cancel: cancelReader } = useTerminalReader(readable, {
  onRead(data) {
    const message = textDecoder.decode(data)
    serialTerminalRef.value?.write(message, 'input')
  },
})

const { write, error: writeError, close: closeWriter } = useTerminalWriter(writable)

async function handleSend(payload: { content: string }) {
  const terminal = serialTerminalRef.value
  if (!terminal) {
    return
  }

  await write(textEncoder.encode(payload.content))
}

async function toggleConnection() {
  if (port.value) {
    try {
      await closeWriter()
      await cancelReader()
      await port.value.close()
    } catch (e) {
      console.error(e)
    }
    port.value = null
    return
  }
  try {
    const port_ = await navigator.serial.requestPort({
      filters: []
    })

    if (!port_.readable && !port_.writable) {
      await port_.open({ baudRate: 9600 })
    }

    port.value = port_
  } catch (e) {
    console.error(e)
  }
}

const input = ref('')

const serialTerminalRef = useTemplateRef('serialTerminal')

function clearOutput() {
  serialTerminalRef.value?.clear()
}

</script>

<template>
  <div class="w-xl h-96 overflow-hidden">
    <SerialTerminal
      class="size-full"
      ref="serialTerminal"
      v-model:input="input"
      :max-entries="20"
      @send="handleSend"
    >
      <SerialTerminalHeader>
        <Button 
          variant="ghost" 
          size="sm" 
          aria-label="Connect" 
          @click="toggleConnection"
        >
          <LinkIcon :size="12" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          aria-label="Clear" 
          @click="clearOutput"
        >
          <TrashIcon :size="12" />
        </Button>
      </SerialTerminalHeader>
    </SerialTerminal>
  </div>
</template>
