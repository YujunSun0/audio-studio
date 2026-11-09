import { useRef, useState, type DragEvent } from 'react'
import type { AudioFormat, Quality, SplitMode } from '../lib/types'
import type { Runner } from '../lib/useRunner'
import { separator } from '../separator'
import { FORMAT_OPTIONS, MODE_OPTIONS, QUALITY_OPTIONS } from './options'
import { PrimaryButton, Segmented } from './ui'

const ACCEPT ='.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.webm,.mp4,.wma,.aiff,.aif,audio/*'

export function UploadForm({ runner }: { runner: Runner }) {
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [mode, setMode] = useState<SplitMode>('2stem')
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [quality, setQuality] = useState<Quality>('fast')
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = (f: File | undefined) => {
    if (f) setFile(f)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (!runner.busy) pick(e.dataTransfer.files[0])
  }

  const start = () => {
    if (!file || runner.busy) return
    runner.run((onUpdate, signal) => separator.separate(file, { mode, format, quality }, onUpdate, signal))
  }

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!runner.busy) setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors sm:flex-row sm:text-left ${
          drag ? 'border-accent bg-accent/5' : 'border-line bg-panel-2/50'
        }`}
      >
        <div className="grid size-12 shrink-0 place-items-center rounded-full border border-primary/50 text-primary-hi">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
        </div>
        <div className="min-w-0 flex-1">
          {file ? (
            <>
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">음원 파일을 끌어다 놓으세요</p>
              <p className="text-xs text-muted">MP3, WAV, FLAC, M4A 등 · 최대 300MB</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={runner.busy}
          className="h-10 rounded-full border border-line px-4 text-sm text-text hover:border-faint disabled:opacity-50"
        >
          {file ? '다른 파일' : '파일 선택'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <Segmented<SplitMode>
            label="분리 방식"
            value={mode}
            onChange={setMode}
            disabled={runner.busy}
            options={MODE_OPTIONS.filter((o) => separator.modes.includes(o.value))}
          />
          <Segmented label="품질" value={quality} onChange={setQuality} disabled={runner.busy} options={QUALITY_OPTIONS} />
          <Segmented label="파일 형식" value={format} onChange={setFormat} disabled={runner.busy} options={FORMAT_OPTIONS} />
        </div>
        <PrimaryButton onClick={start} disabled={!file || runner.busy} className="w-full sm:w-44">
          {runner.busy ? '분리 중…' : '분리 시작'}
        </PrimaryButton>
      </div>
    </div>
  )
}
