export const ui = [
  {
    name: 'separator-label',
    type: 'registry:ui',
    title: 'Separator Label',
    description: 'A separator with a centered label.',
    // SeparatorLabel.vue uses reactiveOmit from @vueuse/core.
    dependencies: ['reka-ui', '@vueuse/core'],
    files: [
      {
        path: 'ui/separator-label/index.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/separator-label/SeparatorLabel.vue',
        type: 'registry:ui',
      },
    ],
  },
  {
    name: 'serial-terminal',
    type: 'registry:ui',
    title: 'Serial Terminal',
    description: 'A terminal-like component for serial input and output with a configurable maximum number of entries, automatically removing the oldest when the limit is exceeded.',
    // useSerialTerminal.ts imports notNullish/tryOnScopeDispose from @vueuse/core.
    dependencies: ['reka-ui', '@lucide/vue', '@vueuse/core'],
    registryDependencies: ['scroll-area'],
    files: [
      {
        path: 'ui/serial-terminal/index.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminal.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminalHeader.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminalInput.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminalOutput.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminalOutputLine.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminalOutputContent.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/SerialTerminalNewLineToggle.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/encoders.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/useStreamLock.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/useTerminalWriter.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/useTerminalReader.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/useTerminalOutput.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/serial-terminal/useSerialTerminal.ts',
        type: 'registry:ui',
      },
    ],
  },
  {
    name: 'auto-form',
    type: 'registry:ui',
    title: 'Auto Form',
    description: 'Automatically generate a form from a Zod schema, powered by vee-validate.',
    dependencies: [
      'vee-validate',
      '@vee-validate/zod',
      'zod',
      'reka-ui',
      // AutoFormFieldArray/Date/File import icons directly; this was previously
      // undeclared and only resolved by accident via a registryDependency that
      // happened to pull an icon package in.
      '@lucide/vue',
      // AutoFormFieldDate.vue imports DateFormatter/parseDate/etc. directly. The
      // `calendar` registryDependency does not declare it, so it must be listed here.
      '@internationalized/date',
    ],
    registryDependencies: [
      'form',
      'accordion',
      'button',
      'separator',
      'checkbox',
      'switch',
      'calendar',
      'popover',
      'label',
      'radio-group',
      'select',
      'input',
      'textarea',
      'tags-input',
      'pin-input',
    ],
    files: [
      {
        path: 'ui/auto-form/AutoForm.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormField.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldArray.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldBoolean.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldDate.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldEnum.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldFile.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldInput.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldNumber.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldObject.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldPin.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldTags.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormFieldWrapper.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/AutoFormLabel.vue',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/constant.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/dependencies.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/index.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/interface.ts',
        type: 'registry:ui',
      },
      {
        path: 'ui/auto-form/utils.ts',
        type: 'registry:ui',
      },
    ],
  },

]
