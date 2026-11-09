import { useState, type FormEvent } from 'react'
import { createYoutubeJob, watchJob } from '../lib/api'
import type { AudioFormat, Quality, SplitMode } from '../lib/types'
import type { Runner } from '../lib/useRunner'
import { FORMAT_OPTIONS, MODE_OPTIONS, QUALITY_OPTIONS } from './options'
import { PrimaryButton, Segmented } from './ui'

const YT = /^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i

export function YoutubeForm({ runner, separate }: { runner: Runner; separate: boolean }) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<SplitMode>('2stem')
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [quality, setQuality] = useState<Quality>('fast')
  const [touched, setTouched] = useState(false)

  const valid = YT.test(url.trim())
  const showInvalid = touched && url.trim() !== '' && !valid

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid || runner.busy) return
    runner.run(async (onUpdate, signal) => {
      const job = await createYoutubeJob({ url: url.trim(), separate, mode, format, quality })
      onUpdate(job)
      return watchJob(job.id, onUpdate, signal)
    })
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      /* clipboard permission denied */
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="yt-url" className="mb-2 block text-xs font-medium text-muted">
          YouTube 링크
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <input
              id="yt-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={runner.busy}
              aria-invalid={showInvalid}
              aria-describedby={showInvalid ? 'yt-url-err' : undefined}
              className={`h-12 w-full rounded-full border bg-panel-2 pr-20 pl-5 text-sm text-text placeholder:text-faint focus:outline-none disabled:opacity-60 ${
                showInvalid ? 'border-danger' : 'border-line focus:border-primary'
              }`}
            />
            {!url && !runner.busy && (
              <button
                type="button"
                onClick={paste}
                className="absolute top-1/2 right-2 h-8 -translate-y-1/2 rounded-full px-3 text-xs text-muted hover:bg-line hover:text-text"
              >
                붙여넣기
              </button>
            )}
          </div>
          <PrimaryButton type="submit" disabled={runner.busy || !url.trim()} className="sm:w-44">
            {runner.busy ? '처리 중…' : separate ? '추출 + 분리 시작' : 'MP3 추출'}
          </PrimaryButton>
        </div>
        {showInvalid && (
          <p id="yt-url-err" className="mt-2 pl-5 text-xs text-danger">
            youtube.com 또는 youtu.be 링크를 넣어 주세요.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {separate && (
          <>
            <Segmented label="분리 방식" value={mode} onChange={setMode} disabled={runner.busy} options={MODE_OPTIONS} />
            <Segmented label="품질" value={quality} onChange={setQuality} disabled={runner.busy} options={QUALITY_OPTIONS} />
          </>
        )}
        <Segmented label="파일 형식" value={format} onChange={setFormat} disabled={runner.busy} options={FORMAT_OPTIONS} />
      </div>
    </form>
  )
}
