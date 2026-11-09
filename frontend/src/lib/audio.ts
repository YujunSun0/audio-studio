/** Max-abs peaks per bucket, channels mixed, normalized to 0..1. */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets)
  const len = buffer.length
  const step = Math.max(1, Math.floor(len / buckets))
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  let max = 0
  for (let b = 0; b < buckets; b++) {
    const start = b * step
    const end = Math.min(start + step, len)
    let peak = 0
    // Sample sparsely inside large buckets; visually identical, much faster.
    const stride = Math.max(1, Math.floor((end - start) / 400))
    for (let i = start; i < end; i += stride) {
      for (const ch of channels) {
        const v = Math.abs(ch[i])
        if (v > peak) peak = v
      }
    }
    peaks[b] = peak
    if (peak > max) max = peak
  }
  if (max > 0) for (let b = 0; b < buckets; b++) peaks[b] /= max
  return peaks
}

/** 16-bit PCM WAV. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels
  const rate = buffer.sampleRate
  const frames = buffer.length
  const dataSize = frames * numCh * 2
  const out = new DataView(new ArrayBuffer(44 + dataSize))
  const str = (off: number, s: string) => [...s].forEach((c, i) => out.setUint8(off + i, c.charCodeAt(0)))

  str(0, 'RIFF')
  out.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, numCh, true)
  out.setUint32(24, rate, true)
  out.setUint32(28, rate * numCh * 2, true)
  out.setUint16(32, numCh * 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, dataSize, true)

  const chans = Array.from({ length: numCh }, (_, i) => buffer.getChannelData(i))
  let off = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      out.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
