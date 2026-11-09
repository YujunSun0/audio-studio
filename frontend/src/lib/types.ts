export type StemId = 'original' | 'vocals' | 'instrumental' | 'drums' | 'bass' | 'other'
export type SplitMode = '2stem' | '4stem'
export type AudioFormat = 'mp3' | 'wav'
export type Quality = 'fast' | 'high'

export type JobStatus = 'queued' | 'running' | 'done' | 'error'
export type JobStage = 'queued' | 'download' | 'convert' | 'load_model' | 'separate' | 'encode' | 'done'

export interface OutputFile {
  name: string
  stem: StemId
  url: string
}

export interface Job {
  id: string
  kind: 'extract' | 'separate' | 'full'
  status: JobStatus
  stage: JobStage
  /** 0..100, null when the current step can't report progress */
  progress: number | null
  message: string
  title: string
  error: string | null
  files: OutputFile[]
  created: number
  started: number | null
  finished: number | null
  queue_position: number
}

export const STEM_LABEL: Record<StemId, string> = {
  original: '원곡',
  vocals: '보컬',
  instrumental: '반주',
  drums: '드럼',
  bass: '베이스',
  other: '기타 악기',
}

export const STEM_COLOR: Record<StemId, string> = {
  original: 'var(--color-stem-original)',
  vocals: 'var(--color-stem-vocals)',
  instrumental: 'var(--color-stem-instrumental)',
  drums: 'var(--color-stem-drums)',
  bass: 'var(--color-stem-bass)',
  other: 'var(--color-stem-other)',
}
