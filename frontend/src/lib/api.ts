import type { AudioFormat, Job, Quality, SplitMode } from './types'

/** Same origin in production (FastAPI serves the build); proxied by Vite in dev. */
const API = ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, init)
  } catch {
    throw new Error('서버에 연결할 수 없어요. 백엔드가 실행 중인지 확인해 주세요.')
  }
  if (!res.ok) {
    let detail = `요청 실패 (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = '입력값을 확인해 주세요.'
    } catch {
      /* not json */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export function getHealth() {
  return request<{ ok: boolean; gpu: string | null }>('/api/health')
}

export function createYoutubeJob(body: {
  url: string
  separate: boolean
  mode: SplitMode
  format: AudioFormat
  quality: Quality
}) {
  return request<Job>('/api/jobs/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function createUploadJob(file: File, mode: SplitMode, format: AudioFormat, quality: Quality) {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  form.append('format', format)
  form.append('quality', quality)
  return request<Job>('/api/jobs/upload', { method: 'POST', body: form })
}

/**
 * Follow a job over SSE until it finishes. Falls back to polling if the
 * stream drops (e.g. the backend restarts mid-job).
 */
export function watchJob(id: string, onUpdate: (job: Job) => void, signal?: AbortSignal): Promise<Job> {
  return new Promise((resolve, reject) => {
    let es: EventSource | null = null
    let pollTimer: number | undefined

    const finish = (job: Job) => {
      cleanup()
      resolve(job)
    }
    const cleanup = () => {
      es?.close()
      if (pollTimer) window.clearTimeout(pollTimer)
    }
    const handle = (job: Job) => {
      onUpdate(job)
      if (job.status === 'done' || job.status === 'error') finish(job)
    }
    const poll = async () => {
      try {
        handle(await request<Job>(`/api/jobs/${id}`))
      } catch (e) {
        cleanup()
        reject(e)
        return
      }
      pollTimer = window.setTimeout(poll, 1000)
    }

    signal?.addEventListener('abort', () => {
      cleanup()
      reject(new DOMException('aborted', 'AbortError'))
    })

    es = new EventSource(`${API}/api/jobs/${id}/events`)
    es.onmessage = (ev) => handle(JSON.parse(ev.data) as Job)
    es.onerror = () => {
      es?.close()
      es = null
      poll()
    }
  })
}

export const downloadUrl = (url: string) => `${API}${url}?download=true`
export const streamUrl = (url: string) => `${API}${url}`
