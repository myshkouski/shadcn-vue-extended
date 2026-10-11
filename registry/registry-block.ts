export const block = [
  {
    // Named apart from the `serial-terminal` ui item on purpose: both are
    // built into `r/<name>.json`, so one name would be one file serving two
    // registry items.
    name: 'serial-terminal-01',
    type: 'registry:block',
    title: 'Serial Terminal 01',
    description: 'A serial terminal with a device picker, baud rate selection and a bounded output buffer.',
    // SerialTerminal.vue reads the output through pretty-bytes, toasts
    // failures through vue-sonner and talks to WebSerial through
    // vue-extras; its emulator emits bytes from uncrypto.
    dependencies: [
      'reka-ui',
      '@lucide/vue',
      '@vueuse/core',
      'pretty-bytes',
      'uncrypto',
      'vue-extras',
      'vue-sonner',
    ],
    registryDependencies: [
      'serial-terminal',
      'button',
      'card',
      'dialog',
      'label',
      'radio-group',
      'select',
    ],
    files: [
      {
        path: 'blocks/serial-terminal/index.ts',
        type: 'registry:component',
      },
      {
        path: 'blocks/serial-terminal/SerialTerminal.vue',
        type: 'registry:component',
      },
      {
        path: 'blocks/serial-terminal/SerialTerminalConnectDialog.vue',
        type: 'registry:component',
      },
    ],
  },
  {
    name: 'dialog-01',
    type: 'registry:block',
    title: 'Dialog 01',
    description: 'A dialog block example.',
    dependencies: ['@lucide/vue'],
    registryDependencies: [
      'button',
      'dialog',
    ],
    files: [
      {
        path: 'blocks/dialog-01/index.vue',
        type: 'registry:component',
      },
    ],
  },
  {
    name: 'dialog-02',
    type: 'registry:block',
    title: 'Dialog 02',
    description: 'A dialog block example.',
    dependencies: ['@lucide/vue'],
    registryDependencies: [
      'button',
      'dialog',
    ],
    files: [
      {
        path: 'blocks/dialog-02/index.vue',
        type: 'registry:component',
      },
    ],
  },
]
