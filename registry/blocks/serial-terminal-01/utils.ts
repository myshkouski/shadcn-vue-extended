import type { SerialTerminalPortOption } from "./SerialTerminalConnectDialog.vue"
import type { TerminalTargetDevice } from "./types"

export function describePort(port: SerialPort, index: number): SerialTerminalPortOption {
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

export function describeDevice(device: TerminalTargetDevice | null | undefined): string {
  if (!device)
    return String(device)
  const raw = toRaw(device)
  return `${Object.getPrototypeOf(raw).constructor.name} { readable: ${describeStream(raw.readable)}, writable: ${describeStream(raw.writable)} }`
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