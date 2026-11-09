import type { AudioFormat, Job, Quality, SplitMode } from '../lib/types'

export interface SeparationOptions {
  mode: SplitMode
  format: AudioFormat
  quality: Quality
}

/**
 * Where vocal separation runs. The local build uses the FastAPI + GPU backend;
 * the planned public build swaps in an in-browser (ONNX Runtime Web / WebGPU)
 * engine with the same contract, so the UI does not change.
 */
export interface SeparatorEngine {
  readonly id: 'server' | 'browser'
  /** Which split modes this engine can do. */
  readonly modes: SplitMode[]
  separate(file: File, opts: SeparationOptions, onUpdate: (job: Job) => void, signal?: AbortSignal): Promise<Job>
}
