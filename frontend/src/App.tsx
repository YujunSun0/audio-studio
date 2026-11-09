import { useEffect, useState } from 'react'
import { Hero } from './components/Hero'
import { JobProgress } from './components/JobProgress'
import { StemMixer } from './components/StemMixer'
import { Card, ErrorBox, GhostButton } from './components/ui'
import { UploadForm } from './components/UploadForm'
import { YoutubeForm } from './components/YoutubeForm'
import { downloadUrl, getHealth } from './lib/api'
import { useRunner, type Runner } from './lib/useRunner'

type Tab = 'full' | 'extract' | 'separate'

const TABS: { id: Tab; label: string; badge: string; title: string; desc: string }[] = [
  {
    id: 'full',
    label: '한 번에 처리',
    badge: 'MP3',
    title: 'YouTube → MP3 → 보컬 분리',
    desc: '링크 하나로 원곡 MP3와 보컬, 반주 트랙을 한 번에 만들어요.',
  },
  {
    id: 'extract',
    label: 'MP3 추출',
    badge: 'MP3',
    title: 'YouTube → MP3',
    desc: '영상에서 오디오만 뽑아 320kbps MP3로 저장해요.',
  },
  {
    id: 'separate',
    label: '보컬 분리',
    badge: 'VOX',
    title: '보컬 리무버 · 보컬 추출',
    desc: '가지고 있는 음원 파일에서 보컬과 반주를 나눠요.',
  },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('full')
  const runners: Record<Tab, Runner> = { full: useRunner(), extract: useRunner(), separate: useRunner() }
  const runner = runners[tab]
  const meta = TABS.find((t) => t.id === tab)!

  const [gpu, setGpu] = useState<string | null | undefined>(undefined)
  const [online, setOnline] = useState(true)
  useEffect(() => {
    getHealth()
      .then((h) => {
        setGpu(h.gpu)
        setOnline(true)
      })
      .catch(() => setOnline(false))
  }, [])

  const job = runner.job
  const active = runner.busy && job?.status !== 'error'

  return (
    <div className="min-h-dvh p-3 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl bg-ink shadow-[0_30px_80px_-20px_rgba(70,20,140,0.45)]">
        {/* App bar */}
        <header className="flex h-14 items-center justify-between gap-4 border-b border-line/70 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
              <circle cx="16" cy="16" r="11" fill="none" stroke="#a24bff" strokeWidth="2" />
              <path d="M7 16h3l2-5 3 10 2-7 2 2h6" fill="none" stroke="#c48bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">Audio Studio</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className={`size-2 rounded-full ${!online ? 'bg-danger' : gpu ? 'bg-accent' : 'bg-faint'}`} />
            <span className="truncate">
              {!online ? '백엔드 연결 안 됨' : gpu === undefined ? '연결 확인 중' : gpu ? `GPU · ${gpu.replace('NVIDIA GeForce ', '')}` : 'CPU 모드 (느림)'}
            </span>
          </div>
        </header>

        <main className="px-4 pt-8 pb-10 sm:px-8 sm:pt-10 lg:px-12">
          {/* Title + tabs */}
          <div className="flex flex-col gap-6 border-b border-line/70 pb-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Audio converter</h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                YouTube 오디오 추출과 AI 보컬 분리를 한곳에서. 모든 처리는 이 PC의 GPU에서 이뤄져요.
              </p>
            </div>
            <div role="tablist" aria-label="작업 종류" className="flex gap-2 overflow-x-auto">
              {TABS.map((t) => {
                const on = t.id === tab
                const busy = runners[t.id].busy
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(t.id)}
                    className={`relative h-11 shrink-0 rounded-md border px-5 text-sm transition-colors ${
                      on ? 'border-accent text-text' : 'border-transparent bg-panel-2 text-muted hover:text-text'
                    }`}
                  >
                    {t.label}
                    {busy && <span className="absolute top-1.5 right-1.5 size-1.5 animate-pulse rounded-full bg-primary-hi" aria-label="처리 중" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="my-6 sm:my-8">
            <Hero badge={meta.badge} active={active} progress={job?.progress ?? null} done={job?.status === 'done'} />
          </div>

          <div className="mx-auto max-w-4xl space-y-4">
            <Card>
              <div className="mb-5">
                <h2 className="text-lg font-medium">{meta.title}</h2>
                <p className="mt-1 text-sm text-muted">{meta.desc}</p>
              </div>
              {tab === 'separate' ? (
                <UploadForm runner={runner} />
              ) : (
                <YoutubeForm key={tab} runner={runner} separate={tab === 'full'} />
              )}
            </Card>

            {(job || runner.error) && (
              <Card>
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted">
                      {job?.status === 'done' ? '결과' : job?.status === 'error' || runner.error ? '실패' : '진행 상황'}
                    </p>
                    <h3 className="mt-1 truncate text-base font-medium">{job?.title || '작업 준비 중'}</h3>
                  </div>
                  {!runner.busy && (
                    <GhostButton onClick={runner.reset} className="shrink-0">
                      지우기
                    </GhostButton>
                  )}
                </div>

                {runner.error ? <ErrorBox>{runner.error}</ErrorBox> : job && job.status !== 'done' && <JobProgress job={job} />}

                {job?.status === 'done' && <Results job={job} />}
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function Results({ job }: { job: NonNullable<Runner['job']> }) {
  const original = job.files.find((f) => f.stem === 'original')
  const stems = job.files.filter((f) => f.stem !== 'original')

  if (!stems.length) return original ? <StemMixer files={[original]} title={job.title} /> : null

  return (
    <div className="space-y-5">
      {original && (
        <a
          href={downloadUrl(original.url)}
          download={original.name}
          className="flex items-center justify-between gap-4 rounded-xl border border-primary/40 bg-primary/8 px-4 py-3 text-sm transition hover:border-primary"
        >
          <span className="min-w-0 truncate">
            <span className="text-muted">원곡 · </span>
            {original.name}
          </span>
          <span className="shrink-0 font-medium text-primary-hi">다운로드</span>
        </a>
      )}
      <StemMixer files={stems} title={job.title} />
    </div>
  )
}
