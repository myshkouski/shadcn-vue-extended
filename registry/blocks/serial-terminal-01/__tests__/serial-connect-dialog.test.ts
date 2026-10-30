import type { SerialTerminalPortOption } from '../SerialTerminalConnectDialog.vue'
import { Select } from '@/components/ui/select'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SerialTerminalExample from '../SerialTerminal.vue'
import SerialTerminalConnectDialog from '../SerialTerminalConnectDialog.vue'

const { mocks, state } = vi.hoisted(() => ({
  mocks: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  state: {
    ports: [] as unknown[],
  },
}))

vi.mock('vue-extras', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-extras')>()
  const { ref } = await import('vue')

  return {
    ...actual,
    useSerial: () => ({
      isSupported: ref(true),
      error: ref(undefined),
      ports: ref(state.ports),
      connect: mocks.connect,
      disconnect: mocks.disconnect,
    }),
  }
})

function flush(ms = 60) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// The dialog renders through a portal into `document.body`, so it is out of the
// wrapper's tree and has to be queried from the document itself.
function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]')!
}

function dialogText() {
  return dialog().textContent ?? ''
}

// The footer opens the picked port, the one in the port section opens the
// browser device picker: both read "Connect", so they are told apart by slot.
function dialogSubmit() {
  return dialog().querySelector<HTMLButtonElement>('[data-slot="serial-terminal-connect-submit"]')!
}

function dialogRequestPort() {
  return dialog().querySelector<HTMLButtonElement>('[data-slot="serial-terminal-connect-request-port"]')!
}

function dialogRadio(index: number) {
  return dialog().querySelectorAll<HTMLElement>('[role="radio"]')[index]!
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find(button => button.attributes('aria-label') === label)
}

function createPort(info: Record<string, number>, overrides: Record<string, unknown> = {}) {
  return {
    readable: null,
    writable: null,
    getInfo: () => info,
    open: vi.fn(),
    close: vi.fn(),
    ...overrides,
  }
}

async function openDialogForSerialTarget() {
  const wrapper = mount(SerialTerminalExample, { attachTo: document.body })
  await flush()
  await nextTick()

  // Echo, random generator, GPS emulator, serial port.
  await wrapper.findAll('[role="radio"]')[3]!.trigger('click')
  await flush()
  await nextTick()

  await findButton(wrapper, 'Connect')!.trigger('click')
  await flush()
  await nextTick()

  return wrapper
}

describe('serial connect dialog', () => {
  beforeEach(() => {
    state.ports = []
    mocks.connect.mockReset()
    mocks.disconnect.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists the ports the browser knows and opens the picked one at the picked rate', async () => {
    const firstPort = createPort({ usbVendorId: 0x10C4, usbProductId: 0xEA60 })
    const pickedPort = createPort({ usbVendorId: 0x10C4, usbProductId: 0xEA61 })
    state.ports = [firstPort, pickedPort]

    const wrapper = await openDialogForSerialTarget()

    expect(dialogText()).toContain('USB 10c4:ea60')
    expect(dialogText()).toContain('USB 10c4:ea61')
    expect(dialogText()).toContain('9,600')

    // Picking never starts anything: a port can only be opened from a user
    // gesture, and the connect button below is the one that counts.
    expect(firstPort.open).not.toHaveBeenCalled()
    expect(pickedPort.open).not.toHaveBeenCalled()

    // Second port, so connecting what is picked is not the same as taking the
    // one that happens to come first.
    dialogRadio(1).click()
    await flush()
    await nextTick()

    dialogSubmit().click()
    await flush(200)
    await nextTick()

    expect(pickedPort.open).toHaveBeenCalledWith({ baudRate: 9600 })
    expect(firstPort.open).not.toHaveBeenCalled()
    expect(findButton(wrapper, 'Disconnect')).toBeDefined()

    wrapper.unmount()
  })

  it('opens the browser device picker from its own button, at the picked rate', async () => {
    const port = createPort({ usbVendorId: 0x2341, usbProductId: 0x0043 })
    mocks.connect.mockResolvedValue(port)
    state.ports = []

    const wrapper = await openDialogForSerialTarget()

    // Nothing is known yet, so the picker is the only way in: its click is the
    // gesture the browser requires.
    expect(dialogText()).toContain('No ports available')
    expect(dialogSubmit().disabled).toBe(true)

    dialogRequestPort().click()
    await flush(200)
    await nextTick()

    expect(mocks.connect).toHaveBeenCalledWith({ filters: [] })
    expect(port.open).toHaveBeenCalledWith({ baudRate: 9600 })

    wrapper.unmount()
  })

  it('attaches to an already open port without calling open() again', async () => {
    const port = createPort(
      { usbVendorId: 0x10C4, usbProductId: 0xEA60 },
      { readable: new ReadableStream(), writable: new WritableStream() },
    )
    state.ports = [port]

    const wrapper = await openDialogForSerialTarget()

    expect(dialogText()).toContain('Already open')

    dialogSubmit().click()
    await flush(200)
    await nextTick()

    expect(port.open).not.toHaveBeenCalled()
    expect(findButton(wrapper, 'Disconnect')).toBeDefined()

    wrapper.unmount()
  })

  it('has nothing to connect to without ports or the browser picker', async () => {
    const wrapper = mount(SerialTerminalConnectDialog, {
      props: { open: true },
      attachTo: document.body,
    })
    await nextTick()

    expect(dialogText()).toContain('No ports available')
    expect(dialogSubmit().disabled).toBe(true)

    wrapper.unmount()
  })

  it('connects at the bound baud rate and reports the rate the select picks', async () => {
    const wrapper = mount(SerialTerminalConnectDialog, {
      props: {
        open: true,
        baudRate: 115_200,
        ports: [{ key: '0', label: 'USB 10c4:ea60' }],
      },
      attachTo: document.body,
    })
    await nextTick()

    expect(dialogText()).toContain('115,200')

    wrapper.findComponent(Select).vm.$emit('update:modelValue', '57600')
    await nextTick()

    expect(wrapper.emitted('update:baudRate')).toEqual([[57_600]])
    expect(dialogText()).toContain('57,600')

    dialogSubmit().click()
    await nextTick()

    expect(wrapper.emitted('connect')).toEqual([[{ portKey: '0', baudRate: 57_600 }]])

    wrapper.unmount()
  })

  it('drops a selection whose port is gone once the dialog is reopened', async () => {
    const wrapper = mount(SerialTerminalConnectDialog, {
      props: {
        open: true,
        ports: [{ key: '0', label: 'USB 10c4:ea60' }] satisfies SerialTerminalPortOption[],
      },
      attachTo: document.body,
    })
    await nextTick()

    // The device is unplugged while the dialog stays open: the key that was
    // selected resolves to nothing, so it must not be carried into the next
    // connect.
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ ports: [] })
    await wrapper.setProps({ open: true })
    await nextTick()

    expect(dialogSubmit().disabled).toBe(true)

    wrapper.unmount()
  })

  it('reports the picked rate when the picker is asked for, without a port', async () => {
    const wrapper = mount(SerialTerminalConnectDialog, {
      props: {
        open: true,
        allowRequestPort: true,
        baudRate: 115_200,
        ports: [{ key: '0', label: 'USB 10c4:ea60' }],
      },
      attachTo: document.body,
    })
    await nextTick()

    dialogRequestPort().click()
    await nextTick()

    expect(wrapper.emitted('requestPort')).toEqual([[{ baudRate: 115_200 }]])
    expect(wrapper.emitted('connect')).toBeUndefined()

    wrapper.unmount()
  })
})
