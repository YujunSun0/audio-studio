import { createUploadJob, watchJob } from '../lib/api'
import type { SeparatorEngine } from './types'

export const serverSeparator: SeparatorEngine = {
  id: 'server',
  modes: ['2stem', '4stem'],
  async separate(file, opts, onUpdate, signal) {
    const job = await createUploadJob(file, opts.mode, opts.format, opts.quality)
    onUpdate(job)
    return watchJob(job.id, onUpdate, signal)
  },
}
