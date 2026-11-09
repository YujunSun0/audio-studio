import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-2 text-xs font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              title={o.hint}
              className={`h-10 rounded-md border px-4 text-sm transition-colors disabled:opacity-50 ${
                on
                  ? 'border-accent bg-accent/8 text-text'
                  : 'border-line bg-panel-2 text-muted hover:border-faint hover:text-text'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function PrimaryButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-white shadow-[0_0_24px_rgba(162,75,255,0.45)] transition hover:bg-primary-hi disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-faint disabled:shadow-none ${className}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line bg-panel-2 px-4 text-sm text-text transition hover:border-faint disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-panel p-5 sm:p-6 ${className}`}>{children}</section>
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ffc2cc]">
      {children}
    </div>
  )
}
