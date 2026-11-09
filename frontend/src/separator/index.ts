import { serverSeparator } from './server'
import type { SeparatorEngine } from './types'

// Public build: replace with the browser engine (see separator/types.ts).
export const separator: SeparatorEngine = serverSeparator

export type { SeparationOptions, SeparatorEngine } from './types'
