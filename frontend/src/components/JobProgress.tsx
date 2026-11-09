import { useEffect, useState } from 'react'
import type { Job, JobStage } from '../lib/types'

type Step = { id: string; label: string; stages: JobStage[] }

function stepsFor(job: Job): Step[] {
  const steps: Step[] = []
  if (job.kind !== 'separate') {
    steps.push({ id: 'dl', label: '다운로드', stages: ['download'] })
    steps.push({ id: 'conv', label: '변환', stages: ['convert'] })
  }
  if (job.kind !== 'extract') {
    steps.push({ id: 'sep', label: '분리', stages: ['convert', 'load_model', 'separate'] })
    steps.push({ id: 'save', label: '저장', stages: ['encode'] })
  }
  return steps
}

/** Index of the active step. Handles the "convert" stage that belongs to two steps in full mode. */
function activeIndex(job: Job, steps: Step[]): number {
  if (job.status === 'done') return steps.length
  if (job.kind === 'full' && job.stage === 'convert') {
    // First convert = MP3 transcoding (no original file yet), second = model input prep.
    return job.files.some((f) => f.stem === 'original') ? 2 : 1
  }
  const i = steps.findIndex((s) => s.stages.includes(job.stage))
  return i < 0 ? 0 : i
}

export function JobProgress({ job }: { job: Job }) {
  const steps = stepsFor(job)
  const idx = activeIndex(job, steps)
  const running = job.status === 'running' || job.status === 'queued'

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running])
  const elapsed = job.started ? Math.max(0, Math.round((job.finished ? job.finished * 1000 : now) / 1000 - job.started)) : 0

  return (
    <div className="space-y-4">
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const state = i < idx ? 'done' : i === idx && running ? 'active' : 'todo'
          return (
            <li key={s.id} className="min-w-0">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
                {state === 'done' && <div className="absolute inset-0 bg-primary" />}
                {state === 'active' &&
                  (job.progress != null ? (
                    <div className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300" style={{ width: `${job.progress}%` }} />
                  ) : (
                    <div className="absolute inset-y-0 w-2/5 bg-primary" style={{ animation: 'indeterminate 1.2s ease-in-out infinite' }} />
                  ))}
              </div>
              <div className={`mt-2 truncate text-xs ${state === 'todo' ? 'text-faint' : 'text-text'}`}>
                {i + 1}. {s.label}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <p className="min-w-0 truncate text-muted" aria-live="polite">
          {job.status === 'queued'
            ? `대기 중${job.queue_position > 1 ? ` (${job.queue_position - 1}개 작업 뒤)` : ''}`
            : job.status === 'done'
              ? '완료됐어요'
              : job.message}
        </p>
        <span className="shrink-0 font-mono text-xs text-faint tabular-nums">{elapsed}s</span>
      </div>
    </div>
  )
}
