<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PlusIcon } from '@lucide/vue'
import { watchImmediate } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

export interface SerialTerminalPortOption {
  /**
   * Stable identity of the port, handed back on `connect` as `portKey` so the
   * owner can resolve the matching device itself.
   */
  key: string
  label: string
  description?: string
  /**
   * The port is already open. It stays selectable: opening a port twice throws,
   * but attaching to the streams it already exposes does not.
   */
  open?: boolean
}

export interface SerialTerminalConnectPayload {
  /** Key of the picked port, for the owner to resolve the device itself. */
  portKey: string
  baudRate: number
}

export interface SerialTerminalRequestPortPayload {
  /** Baud rate picked in the dialog, to open the new device with. */
  baudRate: number
}

export interface SerialTerminalConnectDialogProps {
  class?: HTMLAttributes['class']
  ports?: readonly SerialTerminalPortOption[]
  baudRates?: readonly number[]
  /**
   * Shows the separate button that asks the browser for a device. Kept
   * out of `ports` because the browser picker is an owner concern: it
   * needs a user gesture and a device the owner has to resolve.
   */
  allowRequestPort?: boolean
  busy?: boolean
  title?: string
  description?: string
  requestPortLabel?: string
}

const props = withDefaults(defineProps<SerialTerminalConnectDialogProps>(), {
  ports: () => [],
  baudRates: () => [9_600, 19_200, 38_400, 57_600, 115_200, 230_400, 460_800, 921_600],
  allowRequestPort: false,
  busy: false,
  title: 'Connect to serial port',
  description: 'Pick a port and the baud rate to open it with.',
  requestPortLabel: 'Connect',
})

const emit = defineEmits<{
  (e: 'connect', payload: SerialTerminalConnectPayload): void
  (e: 'requestPort', payload: SerialTerminalRequestPortPayload): void
}>()

const open = defineModel<boolean>('open', { default: false })
const baudRate = defineModel<number | undefined>('baudRate')

// Left unbound by default, so the first offered rate is the one picked rather
// than a second list of defaults to keep in sync.
const selectedBaudRate = computed(() => baudRate.value ?? props.baudRates[0] ?? 9_600)

const selectedPortKey = shallowRef('')

const canConnect = computed(() => !props.busy && !!selectedPortKey.value)

// Reopening must not carry a stale choice: a device unplugged while the dialog
// was open leaves a key that no longer resolves to anything, which would open
// the wrong port (or none) on connect.
watchImmediate(open, (isOpen) => {
  if (!isOpen)
    return

  const keys = props.ports.map(port => port.key)

  if (keys.includes(selectedPortKey.value))
    return

  selectedPortKey.value = keys[0] ?? ''
})

function handleBaudRateUpdate(value: unknown) {
  const rate = Number(value)

  if (Number.isFinite(rate))
    baudRate.value = rate
}

function handleConnect() {
  if (!canConnect.value)
    return

  emit('connect', {
    portKey: selectedPortKey.value,
    baudRate: selectedBaudRate.value,
  })
}

// The browser only shows its device picker within a user gesture, so the owner
// has to be called straight from this click rather than from a watcher.
function handleRequestPort() {
  if (props.busy)
    return

  emit('requestPort', { baudRate: selectedBaudRate.value })
}

function formatBaudRate(rate: number) {
  return rate.toLocaleString('en-US')
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogContent class="max-w-md gap-0 border-0 bg-transparent p-0 shadow-none">
      <Card
        data-slot="serial-terminal-connect-dialog"
        :class="cn('gap-4 py-4', props.class)"
      >
        <CardHeader>
          <DialogTitle as-child>
            <CardTitle>
              {{ props.title }}
            </CardTitle>
          </DialogTitle>
          <DialogDescription as-child>
            <CardDescription>
              {{ props.description }}
            </CardDescription>
          </DialogDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label id="serial-terminal-connect-port-label">
              Port
            </Label>

            <p
              v-if="!props.ports.length"
              class="rounded-md border border-dashed p-3 text-muted-foreground text-xs italic"
            >
              No ports available.
            </p>

            <RadioGroup
              v-else
              v-model="selectedPortKey"
              aria-labelledby="serial-terminal-connect-port-label"
            >
              <!--
                The radio ids follow the position rather than the port key: a
                key is the owner's own identity for a device and may hold
                characters an id cannot, while the position always renders and
                always stays unique within the list.
              -->
              <div
                v-for="(port, index) in props.ports"
                :key="port.key"
                class="flex items-start gap-3 rounded-md border p-3 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem
                  :id="`serial-terminal-connect-port-${index}`"
                  class="mt-0.5"
                  :value="port.key"
                />
                <Label
                  :for="`serial-terminal-connect-port-${index}`"
                  class="flex-1 flex-col items-start gap-0.5"
                >
                  <span class="text-foreground flex items-center gap-2">
                    {{ port.label }}
                    <span
                      v-if="port.open"
                      class="rounded bg-muted px-1 py-0.5 text-muted-foreground text-xs"
                    >
                      Open
                    </span>
                  </span>
                  <span
                    v-if="port.description"
                    class="text-muted-foreground text-sm"
                  >
                    {{ port.description }}
                  </span>
                </Label>
              </div>
            </RadioGroup>

            <!--
              Its own button rather than another row in the list: it does not
              pick from what is known, it asks the browser for something new,
              and the gesture it needs is its own click.
            -->
            <Button
              v-if="props.allowRequestPort"
              data-slot="serial-terminal-connect-request-port"
              variant="outline"
              class="w-full"
              :disabled="props.busy"
              @click="handleRequestPort"
            >
              <PlusIcon />
              {{ props.requestPortLabel }}
            </Button>
          </div>

          <div class="space-y-2">
            <Label for="serial-terminal-connect-baud-rate">
              Baud rate
            </Label>
            <Select
              :model-value="String(selectedBaudRate)"
              @update:model-value="handleBaudRateUpdate"
            >
              <SelectTrigger
                id="serial-terminal-connect-baud-rate"
                class="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="rate in props.baudRates"
                  :key="rate"
                  :value="String(rate)"
                >
                  {{ formatBaudRate(rate) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>

        <CardFooter class="justify-end gap-2 border-t">
          <DialogClose as-child>
            <Button
              variant="outline"
              :disabled="props.busy"
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            data-slot="serial-terminal-connect-submit"
            :disabled="!canConnect"
            @click="handleConnect"
          >
            Connect
          </Button>
        </CardFooter>
      </Card>
    </DialogContent>
  </Dialog>
</template>
