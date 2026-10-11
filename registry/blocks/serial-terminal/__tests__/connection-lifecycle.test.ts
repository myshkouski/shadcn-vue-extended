import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SerialTerminalExample from '../SerialTerminal.vue'

const debugLogs: string[] = []
const errorLogs: string[] = []

function flush(ms = 60) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find(b => b.attributes('aria-label') === label)
}

describe('serial terminal example connection lifecycle', () => {
  beforeEach(() => {
    debugLogs.length = 0
    errorLogs.length = 0
    vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
      debugLogs.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not start a virtual device just by selecting it', async () => {
    const wrapper = mount(SerialTerminalExample)
    await flush()
    await nextTick()

    // Echo is selected by default and must stay closed until connected.
    expect(wrapper.text()).toContain('No output yet')
    expect({
      opened: debugLogs.filter(l => l.includes('watch(target) opened')),
      errors: errorLogs,
    }).toEqual({ opened: [], errors: [] })

    wrapper.unmount()
  })

  it('starts and stops a virtual device from the connect button', async () => {
    const wrapper = mount(SerialTerminalExample)
    await flush()
    await nextTick()

    const radios = wrapper.findAll('[role="radio"]')
    // random generator: streams without waiting for input
    await radios[1].trigger('click')
    await flush()
    await nextTick()

    expect(wrapper.text()).toContain('No output yet')
    expect(debugLogs.filter(l => l.includes('watch(target) opened'))).toEqual([])

    const connect = findButton(wrapper, 'Connect')
    expect(connect).toBeDefined()
    expect(connect!.attributes('disabled')).toBeUndefined()

    await connect!.trigger('click')
    await flush(300)
    await nextTick()

    expect(wrapper.text()).not.toContain('No output yet')
    expect(findButton(wrapper, 'Disconnect')).toBeDefined()

    const disconnect = findButton(wrapper, 'Disconnect')
    await disconnect!.trigger('click')
    await flush()
    await nextTick()

    expect(findButton(wrapper, 'Connect')).toBeDefined()

    wrapper.unmount()
  })

  it('disconnects the previous device when switching options', async () => {
    const wrapper = mount(SerialTerminalExample)
    await flush()
    await nextTick()

    const radios = wrapper.findAll('[role="radio"]')
    await radios[1].trigger('click')
    await flush()
    await nextTick()

    await findButton(wrapper, 'Connect')!.trigger('click')
    await flush(200)
    await nextTick()

    expect(findButton(wrapper, 'Disconnect')).toBeDefined()

    // Switching to a different device must tear the connected one down.
    await radios[2].trigger('click')
    await flush()
    await nextTick()

    expect(debugLogs.filter(l => l.includes('watch(target) closing')).length).toBeGreaterThan(0)
    expect(findButton(wrapper, 'Connect')).toBeDefined()

    wrapper.unmount()
  })
})
