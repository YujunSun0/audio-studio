import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Text inside the badge when idle, e.g. "MP3" or "VOX". */
  badge: string
  /** Whether a job is running (waves animate faster, ring shows progress). */
  active: boolean
  /** 0..100, or null for indeterminate. Ignored when not active. */
  progress: number | null
  done?: boolean
}

const W = 1200
const H = 260
const GAP = 150 // half-width of the gap left for the center badge
const LINES = 7

/** Envelope with a few "bursts", mirrored around the center like the reference. */
function envelope(t: number) {
  // t: 0 at the far edge, 1 next to the badge
  const bump = (c: number, w: number, a: number) => a * Math.exp(-((t - c) ** 2) / (2 * w * w))
  return bump(0.2, 0.07, 0.75) + bump(0.48, 0.11, 0.6) + bump(0.78, 0.06, 1) + 0.04
}

function wavePath(side: -1 | 1, line: number, phase: number, energy: number) {
  const pts: string[] = []
  const steps = 160
  const x0 = W / 2 + side * GAP
  const x1 = side === 1 ? W - 20 : 20
  for (let i = 0; i <= steps; i++) {
    const t = i / steps // 0 near badge -> 1 at edge
    const x = x0 + (x1 - x0) * t
    const env = envelope(1 - t) * (1 - t * 0.35)
    const k = 0.035 + line * 0.0016
    const y =
      H / 2 +
      Math.sin(x * k + phase + line * 0.42) * env * (H * 0.36) * energy +
      Math.sin(x * 0.21 + phase * 2.3 + line) * env * 9 * energy
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return pts.join('')
}

export function Hero({ badge, active, progress, done }: Props) {
  const [phase, setPhase] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setPhase((p) => p + dt * (active ? 2.6 : 0.6))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [active])

  const energy = active ? 1 : done ? 0.75 : 0.55
  const r = 104
  const circ = 2 * Math.PI * r
  const pct = active && progress != null ? Math.max(0, Math.min(100, progress)) : null

  return (
    <div className="relative h-[180px] select-none sm:h-[240px]" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="fadeR" x1="0" x2="1">
            <stop offset="0" stopColor="#c48bff" />
            <stop offset="1" stopColor="#7c2cff" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="fadeL" x1="1" x2="0">
            <stop offset="0" stopColor="#c48bff" />
            <stop offset="1" stopColor="#7c2cff" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <line x1="20" x2={W - 20} y1={H / 2} y2={H / 2} stroke="#a24bff" strokeOpacity="0.25" strokeWidth="1" />
        <g filter="url(#glow)" fill="none" strokeWidth="1.3" vectorEffect="non-scaling-stroke">
          {Array.from({ length: LINES }, (_, i) => (
            <g key={i} strokeOpacity={0.35 + (i / LINES) * 0.6}>
              <path d={wavePath(-1, i, phase, energy)} stroke="url(#fadeL)" vectorEffect="non-scaling-stroke" />
              <path d={wavePath(1, i, phase + 1.3, energy)} stroke="url(#fadeR)" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </g>
      </svg>

      {/* Center badge with progress ring */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative size-[150px] sm:size-[230px]">
          <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(162,75,255,0.28),transparent_70%)]" />
          <svg viewBox="0 0 240 240" className="absolute inset-0 size-full">
            <circle cx="120" cy="120" r={r} fill="#0e0a15" fillOpacity="0.7" stroke="#a24bff" strokeOpacity="0.35" strokeWidth="2" />
            {active && pct != null && (
              <circle
                cx="120"
                cy="120"
                r={r}
                fill="none"
                stroke="#b874ff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circ} ${circ}`}
                transform="rotate(-90 120 120)"
                style={{ transition: 'stroke-dasharray 300ms ease', filter: 'drop-shadow(0 0 6px #a24bff)' }}
              />
            )}
            {active && pct == null && (
              <g style={{ transformOrigin: '120px 120px', animation: 'spin-slow 1.4s linear infinite' }}>
                <circle
                  cx="120"
                  cy="120"
                  r={r}
                  fill="none"
                  stroke="#b874ff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${circ * 0.22} ${circ}`}
                  style={{ filter: 'drop-shadow(0 0 6px #a24bff)' }}
                />
              </g>
            )}
            {!active && (
              <circle cx="120" cy="120" r={r} fill="none" stroke="#a24bff" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 10px #a24bff)' }} />
            )}
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="relative grid h-[54px] w-[66px] place-items-center rounded-xl border-2 border-[#d9b8ff] text-[22px] font-medium tracking-tight text-white shadow-[0_0_18px_rgba(162,75,255,0.8),inset_0_0_12px_rgba(162,75,255,0.5)] sm:h-[74px] sm:w-[90px] sm:text-[30px]">
              {active && pct != null ? `${Math.round(pct)}%` : done ? '✓' : badge}
              <span className="absolute -right-2 -bottom-2 h-3 w-6 rounded-sm border-2 border-[#d9b8ff] bg-ink" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
