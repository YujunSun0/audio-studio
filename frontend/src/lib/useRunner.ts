import { useCallback, useRef, useState } from 'react'
import type { Job } from './types'

export interface Runner {
  job: Job | null
  error: string | null
  busy: boolean
  run: (fn: (onUpdate: (j: Job) => void, signal: AbortSignal) => Promise<Job>) => Promise<void>
  reset: () => void
}

export function useRunner(): Runner {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const run: Runner['run'] = useCallback(async (fn) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setJob(null)
    setError(null)
    setBusy(true)
    try {
      const final = await fn(setJob, ac.signal)
      setJob(final)
      if (final.status === 'error') setError(final.error ?? '알 수 없는 오류가 발생했어요.')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (abortRef.current === ac) setBusy(false)
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setJob(null)
    setError(null)
    setBusy(false)
  }, [])

  return { job, error, busy, run, reset }
}
