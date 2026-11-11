import { AnimatePresence, motion } from 'motion/react'
import { Camera, Delete, Minus, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { SWATCHES } from '../lib/defaults'
import { pushBack } from '../lib/native'
import { toast } from '../lib/store'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

/* ----------------------------- Buttons ---------------------------- */

type Tone = 'amber' | 'go' | 'ink' | 'ghost' | 'danger'
const TONES: Record<Tone, string> = {
  amber: 'bg-amber text-ink border-ink shadow-hard active:translate-y-[3px] active:shadow-none',
  go: 'bg-go-dark text-white border-ink shadow-hard active:translate-y-[3px] active:shadow-none',
  ink: 'bg-ink text-white border-ink active:bg-ink-2',
  ghost: 'bg-white text-ink border-ink active:bg-bg-2',
  danger: 'bg-white text-stop border-stop active:bg-red-50',
}

export function Btn({
  tone = 'ghost',
  big,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; big?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl border-2 px-4 font-extrabold transition-[transform,box-shadow,background-color] disabled:opacity-40 disabled:shadow-none',
        big ? 'min-h-16 text-xl' : 'min-h-12 text-base',
        TONES[tone],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-2xl border-2 border-ink bg-white', className)}>{children}</section>
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex rounded-xl border-2 border-ink bg-bg-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-12 flex-1 rounded-lg px-2 text-sm font-extrabold transition-colors',
            value === o.value ? 'bg-ink text-white' : 'text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-semibold text-ink-2">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full min-h-12 rounded-xl border-2 border-ink bg-white px-3 text-base font-bold text-ink placeholder:text-slate-400 placeholder:font-semibold'

export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-0.5 text-xs font-extrabold">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{children}</span>
    </span>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-lg border-2 border-stop bg-red-50 px-3 py-2 text-sm font-bold text-stop">
      {children}
    </p>
  )
}

/* ------------------------------ Sheet ----------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    // Android hardware back closes the most recently opened sheet.
    const popBack = pushBack({ close: () => closeRef.current() })
    return () => {
      window.removeEventListener('keydown', onKey)
      popBack()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <motion.div
            className="absolute inset-0 bg-ink/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={cx(
              'relative flex max-h-[94dvh] w-full flex-col rounded-t-3xl border-2 border-b-0 border-ink bg-white sm:rounded-3xl sm:border-b-2',
              wide ? 'sm:max-w-3xl' : 'sm:max-w-md',
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-ink px-4 py-2">
              <h2 id={titleId} className="truncate text-lg font-black">
                {title}
              </h2>
              <button type="button" onClick={onClose} aria-label="Close" className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-ink active:bg-bg-2">
                <X size={22} strokeWidth={3} />
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">{children}</div>
            {footer && <footer className="shrink-0 space-y-2 border-t-2 border-ink bg-bg p-4 pb-[max(1rem,var(--sab))]">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function Confirm({
  open,
  title,
  body,
  action,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: ReactNode
  action: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            tone="danger"
            className="!bg-stop !text-white"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            <Trash2 size={18} strokeWidth={3} /> {action}
          </Btn>
        </div>
      }
    >
      <div className="text-base font-semibold text-ink-2">{body}</div>
    </Sheet>
  )
}

/* ----------------------------- Keypad ----------------------------- */

export function Keypad({ value, onChange, maxLen = 7, decimal }: { value: string; onChange: (v: string) => void; maxLen?: number; decimal?: boolean }) {
  const press = (k: string) => {
    if (k === 'back') return onChange(value.slice(0, -1))
    if (k === 'clear') return onChange('')
    if (k === '.') {
      if (value.includes('.')) return
      return onChange((value || '0') + '.')
    }
    if (decimal && value.includes('.') && value.split('.')[1].length >= 2) return
    const next = value === '0' ? k : value + k
    if (next.replace('.', '').length <= maxLen) onChange(next)
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : 'clear', '0', 'back']
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          aria-label={k === 'back' ? 'Backspace' : k === 'clear' ? 'Clear' : k === '.' ? 'Decimal point' : k}
          className={cx(
            'num grid min-h-14 place-items-center rounded-xl border-2 border-ink text-2xl font-black active:bg-ink active:text-white',
            k === 'clear' || k === 'back' ? 'bg-bg-2 text-base' : 'bg-white',
          )}
        >
          {k === 'back' ? <Delete size={26} strokeWidth={2.5} /> : k === 'clear' ? 'CLEAR' : k}
        </button>
      ))}
    </div>
  )
}

/* -------------------------- Break stepper ------------------------- */

export function BreakStepper({
  minutes,
  onBump,
  dark,
  compact,
}: {
  minutes: number
  onBump: (delta: number) => void
  dark?: boolean
  compact?: boolean
}) {
  const btn = cx(
    'num inline-flex min-h-12 min-w-[4.5rem] items-center justify-center gap-0.5 rounded-xl border-2 px-2 text-sm font-black disabled:opacity-40',
    dark ? 'border-white bg-white/10 text-white active:bg-white active:text-go-dark' : 'border-ink bg-white text-ink active:bg-ink active:text-white',
  )
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Break time">
      <button type="button" className={btn} onClick={() => onBump(-15)} disabled={minutes <= 0} aria-label="Remove 15 minutes of break">
        <Minus size={14} strokeWidth={4} />
        15m
      </button>
      <div className={cx('min-w-0 flex-1 text-center leading-tight', compact && 'px-1')}>
        <div className={cx('text-[10px] font-extrabold uppercase tracking-wider', dark ? 'text-white/80' : 'text-ink-2')}>Break</div>
        <div className="num text-lg font-black" aria-live="polite">
          {minutes}m
        </div>
      </div>
      <button type="button" className={btn} onClick={() => onBump(15)} aria-label="Add 15 minutes of break">
        <Plus size={14} strokeWidth={4} />
        15m
      </button>
    </div>
  )
}

/* ------------------------- Odometer drum -------------------------- */

const DIGIT_H = 1.35 // em

export function OdometerDrum({ value, digits = 6, size = 'lg' }: { value: number; digits?: number; size?: 'lg' | 'sm' }) {
  const str = String(Math.max(0, Math.round(value))).padStart(digits, '0').slice(-Math.max(digits, String(Math.round(value)).length))
  return (
    <div
      className={cx('num inline-flex gap-[3px] rounded-xl bg-ink p-1.5 font-black', size === 'lg' ? 'text-[clamp(2.2rem,11vw,3.75rem)]' : 'text-3xl')}
      role="img"
      aria-label={`Odometer ${Math.round(value).toLocaleString()}`}
    >
      {str.split('').map((ch, i) => {
        const last = i === str.length - 1
        return (
          <span
            key={str.length - i}
            className={cx('relative block w-[0.78em] overflow-hidden rounded-md', last ? 'bg-amber text-ink' : 'bg-white text-ink')}
            style={{ height: `${DIGIT_H}em` }}
          >
            <span
              className="absolute inset-x-0 top-0 flex flex-col items-center transition-transform duration-700 ease-[cubic-bezier(.2,.9,.25,1.1)]"
              style={{ transform: `translateY(-${Number(ch) * DIGIT_H}em)` }}
            >
              {'0123456789'.split('').map((d) => (
                <span key={d} className="grid w-full place-items-center" style={{ height: `${DIGIT_H}em`, lineHeight: 1 }}>
                  {d}
                </span>
              ))}
            </span>
            {/* drum shading */}
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/25 via-transparent to-ink/25" />
          </span>
        )
      })}
    </div>
  )
}

/* ------------------------- Colour swatches ------------------------ */

export function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx('size-12 rounded-xl border-2 border-ink', value === c && 'ring-4 ring-ink ring-offset-2')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

/* --------------------------- Proof photo -------------------------- */

async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 560 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.55)
}

export function PhotoInput({ value, onChange, label = 'Odometer proof photo' }: { value?: string; onChange: (v: string | undefined) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-3">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            onChange(await shrink(f))
          } catch {
            toast("Couldn't read that photo.", 'err')
          }
        }}
      />
      {value ? (
        <>
          <img src={value} alt={label} className="size-14 rounded-xl border-2 border-ink object-cover" />
          <span className="flex-1 text-sm font-bold">Proof photo attached</span>
          <Btn onClick={() => onChange(undefined)} aria-label="Remove photo">
            <Trash2 size={18} />
          </Btn>
        </>
      ) : (
        <Btn className="w-full border-dashed" onClick={() => ref.current?.click()}>
          <Camera size={20} strokeWidth={2.5} /> Add {label.toLowerCase()} <span className="font-semibold text-ink-2">(optional)</span>
        </Btn>
      )}
    </div>
  )
}
