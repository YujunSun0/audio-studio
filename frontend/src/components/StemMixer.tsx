import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadUrl, streamUrl } from '../lib/api'
import { computePeaks, encodeWav, formatTime, saveBlob } from '../lib/audio'
import { STEM_COLOR, STEM_LABEL, type OutputFile } from '../lib/types'
import { GhostButton } from './ui'

interface Track {
  file: OutputFile
  buffer: AudioBuffer
  peaks: Float32Array
  gain: number
  muted: boolean
  solo: boolean
}

const effective = (t: Track, anySolo: boolean) => (anySolo ? (t.solo ? t.gain : 0) : t.muted ? 0 : t.gain)

export function StemMixer({ files, title }: { files: OutputFile[]; title: string }) {
  const ctxRef = useRef<AudioContext | null>(null)
  const gainsRef = useRef(new Map<string, GainNode>())
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const startRef = useRef(0) // ctx time at which offset 0 would have played
  const offsetRef = useRef(0)
  const rafRef = useRef(0)

  const [tracks, setTracks] = useState<Track[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [exporting, setExporting] = useState(false)

  const filesKey = files.map((f) => f.url).join('|')
  const duration = useMemo(() => Math.max(0, ...tracks.map((t) => t.buffer.duration)), [tracks])
  const anySolo = tracks.some((t) => t.solo)
  const multi = files.length > 1

  // ---- load & decode -----------------------------------------------------
  useEffect(() => {
    const ctx = new AudioContext()
    ctxRef.current = ctx
    const gains = new Map<string, GainNode>()
    gainsRef.current = gains
    let cancelled = false
    setTracks([])
    setLoadError(null)
    setPosition(0)
    offsetRef.current = 0

    Promise.all(
      files.map(async (file) => {
        const res = await fetch(streamUrl(file.url))
        if (!res.ok) throw new Error('결과 파일을 불러오지 못했어요.')
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
        const g = ctx.createGain()
        g.connect(ctx.destination)
        gains.set(file.stem, g)
        return { file, buffer, peaks: computePeaks(buffer, 1400), gain: 1, muted: false, solo: false } as Track
      }),
    )
      .then((t) => !cancelled && setTracks(t))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)))

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      sourcesRef.current.forEach((s) => {
        s.onended = null
        try {
          s.stop()
        } catch {
          /* not started */
        }
      })
      sourcesRef.current = []
      setPlaying(false)
      ctx.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey])

  // ---- gains follow UI state ----------------------------------------------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    for (const t of tracks) {
      gainsRef.current.get(t.file.stem)?.gain.setTargetAtTime(effective(t, anySolo), ctx.currentTime, 0.015)
    }
  }, [tracks, anySolo])

  // ---- transport ------------------------------------------------------------
  const stopSources = () => {
    sourcesRef.current.forEach((s) => {
      s.onended = null
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
      s.disconnect()
    })
    sourcesRef.current = []
    cancelAnimationFrame(rafRef.current)
  }

  const startSources = useCallback(
    (offset: number) => {
      const ctx = ctxRef.current
      if (!ctx || !tracks.length) return
      stopSources()
      startRef.current = ctx.currentTime - offset
      sourcesRef.current = tracks.map((t) => {
        const src = ctx.createBufferSource()
        src.buffer = t.buffer
        src.connect(gainsRef.current.get(t.file.stem)!)
        src.start(0, Math.min(offset, t.buffer.duration))
        return src
      })
      const tick = () => {
        const pos = ctx.currentTime - startRef.current
        if (pos >= duration) {
          stopSources()
          offsetRef.current = 0
          setPosition(0)
          setPlaying(false)
          return
        }
        setPosition(pos)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [tracks, duration],
  )

  const toggle = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx || !tracks.length) return
    if (playing) {
      offsetRef.current = ctx.currentTime - startRef.current
      stopSources()
      setPlaying(false)
    } else {
      await ctx.resume()
      startSources(offsetRef.current)
      setPlaying(true)
    }
  }, [playing, tracks.length, startSources])

  const seek = (t: number) => {
    const clamped = Math.max(0, Math.min(t, duration))
    offsetRef.current = clamped
    setPosition(clamped)
    if (playing) startSources(clamped)
  }

  // Space bar toggles playback (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const patch = (stem: string, p: Partial<Track>) =>
    setTracks((ts) => ts.map((t) => (t.file.stem === stem ? { ...t, ...p } : t)))

  // ---- export current mix -------------------------------------------------
  const exportMix = async () => {
    if (!tracks.length) return
    setExporting(true)
    try {
      const rate = tracks[0].buffer.sampleRate
      const off = new OfflineAudioContext(2, Math.ceil(duration * rate), rate)
      for (const t of tracks) {
        const v = effective(t, anySolo)
        if (v <= 0) continue
        const src = off.createBufferSource()
        src.buffer = t.buffer
        const g = off.createGain()
        g.gain.value = v
        src.connect(g).connect(off.destination)
        src.start(0)
      }
      saveBlob(encodeWav(await off.startRendering()), `${title} (Mix).wav`)
    } finally {
      setExporting(false)
    }
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>

  return (
    <div className="space-y-4">
      {/* Transport */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={toggle}
          disabled={!tracks.length}
          aria-label={playing ? '일시정지' : '재생'}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-white shadow-[0_0_20px_rgba(162,75,255,0.5)] transition hover:bg-primary-hi disabled:bg-panel-2 disabled:text-faint disabled:shadow-none"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 size-5" fill="currentColor"><path d="M7 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 7 5.5Z" /></svg>
          )}
        </button>
        <div className="font-mono text-sm text-muted tabular-nums">
          {formatTime(position)} <span className="text-faint">/ {formatTime(duration)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="재생 위치"
          className="h-1 min-w-[120px] flex-1"
          disabled={!tracks.length}
        />
        {multi && (
          <GhostButton onClick={exportMix} disabled={!tracks.length || exporting}>
            {exporting ? '내보내는 중…' : '현재 믹스 WAV로 저장'}
          </GhostButton>
        )}
      </div>

      {/* Tracks */}
      <ul className="space-y-2">
        {(tracks.length ? tracks.map((t) => t.file) : files).map((file) => {
          const t = tracks.find((x) => x.file.stem === file.stem)
          const silent = t ? effective(t, anySolo) === 0 : false
          return (
            <li key={file.url} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel-2/60 p-3 sm:grid-cols-[132px_1fr_auto]">
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: STEM_COLOR[file.stem] }} />
                <span className="text-sm font-medium">{STEM_LABEL[file.stem]}</span>
              </div>

              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                {t ? (
                  <Waveform
                    peaks={t.peaks}
                    color={STEM_COLOR[file.stem]}
                    progress={duration ? position / duration : 0}
                    dim={silent}
                    onSeek={(r) => seek(r * duration)}
                  />
                ) : (
                  <div className="h-14 animate-pulse rounded-md bg-line/60" />
                )}
              </div>

              <div className="col-start-2 row-start-1 flex items-center gap-1.5 sm:col-start-auto sm:row-start-auto">
                {multi && t && (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.01}
                      value={t.gain}
                      onChange={(e) => patch(file.stem, { gain: Number(e.target.value) })}
                      aria-label={`${STEM_LABEL[file.stem]} 볼륨`}
                      className="hidden w-24 lg:block"
                    />
                    <ToggleChip on={t.muted} onClick={() => patch(file.stem, { muted: !t.muted })} label="M" title="음소거" />
                    <ToggleChip on={t.solo} onClick={() => patch(file.stem, { solo: !t.solo })} label="S" title="솔로" accent />
                  </>
                )}
                <a
                  href={downloadUrl(file.url)}
                  download={file.name}
                  className="ml-1 grid size-9 place-items-center rounded-full border border-line text-muted transition hover:border-primary hover:text-text"
                  aria-label={`${STEM_LABEL[file.stem]} 다운로드`}
                  title={file.name}
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" /></svg>
                </a>
              </div>
            </li>
          )
        })}
      </ul>
      {multi && <p className="text-xs text-faint">스페이스바로 재생/정지, 파형을 클릭하면 그 위치로 이동해요. M은 음소거, S는 그 트랙만 듣기예요.</p>}
    </div>
  )
}

function ToggleChip({ on, onClick, label, title, accent }: { on: boolean; onClick: () => void; label: string; title: string; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      aria-label={title}
      className={`grid size-8 place-items-center rounded-md border text-xs font-semibold transition ${
        on
          ? accent
            ? 'border-accent bg-accent/15 text-accent'
            : 'border-danger bg-danger/15 text-danger'
          : 'border-line text-faint hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function Waveform({
  peaks,
  color,
  progress,
  dim,
  onSeek,
}: {
  peaks: Float32Array
  color: string
  progress: number
  dim: boolean
  onSeek: (ratio: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width) return
    const dpr = window.devicePixelRatio || 1
    const h = 56
    canvas.width = Math.round(width * dpr)
    canvas.height = h * dpr
    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, h)

    const resolved = getComputedStyle(canvas).getPropertyValue(color.slice(4, -1)).trim() || '#b874ff'
    const bar = 2
    const gap = 1
    const n = Math.floor(width / (bar + gap))
    const playedX = progress * width
    for (let i = 0; i < n; i++) {
      const p = peaks[Math.floor((i / n) * peaks.length)] ?? 0
      const bh = Math.max(1.5, p * (h - 6))
      const x = i * (bar + gap)
      g.globalAlpha = dim ? 0.18 : x < playedX ? 1 : 0.38
      g.fillStyle = resolved
      g.fillRect(x, (h - bh) / 2, bar, bh)
    }
    g.globalAlpha = 1
    g.fillStyle = '#ffffff'
    g.fillRect(Math.min(playedX, width - 1), 0, 1, h)
  }, [peaks, color, progress, dim, width])

  return (
    <canvas
      ref={canvasRef}
      className="block h-14 w-full cursor-pointer"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSeek((e.clientX - r.left) / r.width)
      }}
    />
  )
}
