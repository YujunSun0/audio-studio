import type { AudioFormat, Quality, SplitMode } from '../lib/types'

export const MODE_OPTIONS: { value: SplitMode; label: string; hint: string }[] = [
  { value: '2stem', label: '보컬 / 반주', hint: 'BS-Roformer · 가장 깨끗한 보컬 분리' },
  { value: '4stem', label: '보컬 · 드럼 · 베이스 · 기타', hint: 'Demucs htdemucs_ft · 4트랙' },
]

export const QUALITY_OPTIONS: { value: Quality; label: string; hint: string }[] = [
  { value: 'fast', label: '빠르게', hint: '4분 곡 약 1분 (RTX 3060 기준)' },
  { value: 'high', label: '고품질', hint: '약 2배 느리지만 경계가 더 매끄러워요' },
]

export const FORMAT_OPTIONS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3 320k' },
  { value: 'wav', label: 'WAV' },
]
