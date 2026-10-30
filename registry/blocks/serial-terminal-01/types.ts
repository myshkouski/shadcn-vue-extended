import type { SerialTerminalTarget } from '~~/registry/ui/serial-terminal'

export interface TerminalTargetDevice extends SerialTerminalTarget {
  open: (...args: any[]) => Promise<void> | void
  close: () => Promise<void> | void
}
