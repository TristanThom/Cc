import { Share2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cardMetrics, cardPeriod, DEFAULT_CARD_KEYS, visibleMetrics, type CardMetric, type CardSpan } from '../lib/card'
import { toDateKey } from '../lib/hours'
import { isNative } from '../lib/native'
import { loadOffers, type Offer } from '../lib/offers'
import { toast, useStore } from '../lib/store'
import type { CardPrefs, Vehicle } from '../lib/types'
import { Btn, cx, Field, inputCls, Segmented, Sheet } from './ui'

const W = 1080
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"

/** Shrinks a font until `text` fits `maxWidth`. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = 900): number {
  let s = size
  do {
    ctx.font = `${weight} ${s}px ${FONT}`
    if (ctx.measureText(text).width <= maxWidth) break
    s -= 4
  } while (s > 20)
  return s
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const deltaText = (d: number) => `${d >= 0 ? '▲' : '▼'} ${Math.abs(d) >= 1000 ? '999+' : Math.abs(Math.round(d))}%`

/**
 * Draws the card. The first metric is the headline; the rest fill a two-column grid. Nothing
 * on a card identifies a rider, an address or the vehicle's plate.
 */
export function drawCard(canvas: HTMLCanvasElement, o: { metrics: CardMetric[]; periodLabel: string; vsLabel: string; tall: boolean; dark: boolean }) {
  const H = o.tall ? 1920 : 1080
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const c = o.dark
    ? { bg: '#070b14', panel: '#131c2e', ink: '#f1f5f9', dim: '#cbd5e1', line: '#f1f5f9', up: '#4ade80', down: '#f87171' }
    : { bg: '#f8fafc', panel: '#ffffff', ink: '#0f172a', dim: '#334155', line: '#0f172a', up: '#15803d', down: '#b91c1c' }
  const PAD = 72
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  // Header: brand at left, period at right.
  let y = PAD + 56
  ctx.fillStyle = '#0f172a'
  roundRect(ctx, PAD, y - 54, 92, 70, 14)
  ctx.fill()
  ctx.strokeStyle = c.line
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#f59e0b'
  ctx.font = `900 46px ui-monospace, Menlo, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.fillText('00', PAD + 46, y - 3)
  ctx.textAlign = 'left'
  ctx.fillStyle = c.ink
  ctx.font = `900 54px ${FONT}`
  ctx.fillText('Waypoint', PAD + 112, y)
  ctx.textAlign = 'right'
  ctx.fillStyle = c.dim
  ctx.font = `800 ${fit(ctx, o.periodLabel, 420, 40, 800)}px ${FONT}`
  ctx.fillText(o.periodLabel, W - PAD, y - 4)
  ctx.textAlign = 'left'

  const footerH = 70
  const [head, ...rest] = o.metrics
  if (!head) {
    ctx.fillStyle = c.dim
    ctx.font = `800 44px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('Nothing to show for this period yet', W / 2, H / 2)
    ctx.textAlign = 'left'
  } else {
    // Headline panel.
    y += 56
    const headH = o.tall ? 430 : rest.length > 4 ? 236 : 300
    ctx.fillStyle = '#f59e0b'
    roundRect(ctx, PAD, y, W - PAD * 2, headH, 36)
    ctx.fill()
    ctx.strokeStyle = c.line
    ctx.lineWidth = 6
    ctx.stroke()
    const compact = headH < 260
    ctx.fillStyle = '#0f172a'
    ctx.font = `900 ${compact ? 32 : 40}px ${FONT}`
    ctx.fillText(head.label.toUpperCase(), PAD + 44, y + (compact ? 56 : 78))
    const size = fit(ctx, head.value, W - PAD * 2 - 88, o.tall ? 210 : compact ? 104 : 170)
    ctx.font = `900 ${size}px ${FONT}`
    ctx.fillText(head.value, PAD + 44, y + headH - (head.delta !== null ? (compact ? 70 : 96) : compact ? 44 : 56))
    if (head.delta !== null) {
      ctx.font = `900 ${compact ? 34 : 40}px ${FONT}`
      ctx.fillText(`${deltaText(head.delta)} ${o.vsLabel}`, PAD + 44, y + headH - (compact ? 24 : 36))
    }
    y += headH + 36

    // Grid of the remaining metrics.
    const rows = Math.ceil(rest.length / 2)
    if (rows > 0) {
      const gap = 28
      const avail = H - y - PAD - footerH
      const tileH = Math.min(o.tall ? 250 : 200, (avail - gap * (rows - 1)) / rows)
      const tileW = (W - PAD * 2 - gap) / 2
      rest.forEach((m, i) => {
        const lone = i === rest.length - 1 && rest.length % 2 === 1
        const x = PAD + (i % 2) * (tileW + gap)
        const ty = y + Math.floor(i / 2) * (tileH + gap)
        const w = lone ? W - PAD * 2 : tileW
        ctx.fillStyle = c.panel
        roundRect(ctx, x, ty, w, tileH, 28)
        ctx.fill()
        ctx.strokeStyle = c.line
        ctx.lineWidth = 5
        ctx.stroke()
        if (tileH < 150) {
          // Short tiles (many metrics on a square card): label left, value right, on one line.
          const mid = ty + tileH / 2
          const ls = Math.min(30, Math.max(20, tileH * 0.34))
          ctx.textBaseline = 'middle'
          ctx.fillStyle = c.ink
          const vs = fit(ctx, m.value, w * 0.5, Math.min(60, tileH * 0.62))
          ctx.font = `900 ${vs}px ${FONT}`
          ctx.textAlign = 'right'
          ctx.fillText(m.value, x + w - 28, mid + 2)
          const valueW = ctx.measureText(m.value).width
          ctx.textAlign = 'left'
          ctx.fillStyle = c.dim
          ctx.font = `800 ${fit(ctx, m.label.toUpperCase(), w - valueW - 80, ls, 800)}px ${FONT}`
          ctx.fillText(m.label.toUpperCase(), x + 28, mid + 2)
          ctx.textBaseline = 'alphabetic'
          return
        }
        ctx.fillStyle = c.dim
        ctx.font = `800 30px ${FONT}`
        ctx.fillText(m.label.toUpperCase(), x + 30, ty + 50)
        ctx.fillStyle = c.ink
        const vs = fit(ctx, m.value, w - 60 - (m.delta !== null && lone ? 260 : 0), 76)
        ctx.font = `900 ${vs}px ${FONT}`
        ctx.fillText(m.value, x + 30, ty + tileH - (m.delta !== null && !lone ? 62 : 34))
        if (m.delta !== null) {
          ctx.fillStyle = m.delta >= 0 ? c.up : c.down
          ctx.font = `900 30px ${FONT}`
          if (lone) {
            ctx.textAlign = 'right'
            ctx.fillText(deltaText(m.delta), x + w - 30, ty + tileH - 38)
            ctx.textAlign = 'left'
          } else ctx.fillText(deltaText(m.delta), x + 30, ty + tileH - 22)
        }
      })
    }
  }

  ctx.fillStyle = c.dim
  ctx.font = `700 30px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('Tracked with Waypoint', W / 2, H - PAD + 10)
  ctx.textAlign = 'left'
}

const VS: Record<CardSpan, string> = { day: 'vs the day before', week: 'vs last week', month: 'vs last month' }

/** The card builder: pick a day, week or month and the metrics to show, then share the image. */
export default function ShareCard({ vehicle }: { vehicle: Vehicle }) {
  const shifts = useStore((s) => s.shifts)
  const txns = useStore((s) => s.txns)
  const stats = useStore((s) => s.stats)
  const settings = useStore((s) => s.settings)
  const setCardPrefs = useStore((s) => s.setCardPrefs)
  const appDark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  const prefs: CardPrefs = settings.card ?? { keys: DEFAULT_CARD_KEYS, hideDollars: false, tall: false, dark: appDark }
  const [open, setOpen] = useState(false)
  const [span, setSpan] = useState<CardSpan>('week')
  const [date, setDate] = useState(toDateKey(Date.now()))
  const [offers, setOffers] = useState<Offer[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (open) loadOffers().then(setOffers).catch(() => setOffers([]))
  }, [open])

  const period = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    const noon = new Date(y, m - 1, d, 12).getTime()
    return cardPeriod(span, Number.isFinite(noon) ? noon : Date.now())
  }, [span, date])
  const all = useMemo(
    () => (open ? cardMetrics({ vehicle, shifts, txns, stats: stats ?? [], offers, rate: settings.rate, unit: settings.unit, fuelSplit: settings.fuelSplit ?? 'ratio', now: Date.now() }, span, period) : []),
    [open, vehicle, shifts, txns, stats, offers, settings.rate, settings.unit, settings.fuelSplit, span, period],
  )
  const shown = visibleMetrics(all, prefs.keys, prefs.hideDollars)

  useEffect(() => {
    if (open && canvas.current) drawCard(canvas.current, { metrics: shown, periodLabel: period.label, vsLabel: VS[span], tall: prefs.tall, dark: prefs.dark })
  })

  const toggle = (key: string) => setCardPrefs({ ...prefs, keys: prefs.keys.includes(key) ? prefs.keys.filter((k) => k !== key) : [...prefs.keys, key] })

  const share = async () => {
    const el = canvas.current
    if (!el) return
    const name = `waypoint-${span}-${toDateKey(period.start)}.png`
    try {
      if (isNative) {
        const base64 = el.toDataURL('image/png').split(',')[1]
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
        const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache })
        await Share.share({ title: 'My Waypoint breakdown', files: [uri] }).catch(() => {})
      } else {
        const a = document.createElement('a')
        a.href = el.toDataURL('image/png')
        a.download = name
        a.click()
        toast('Card image downloaded')
      }
    } catch {
      toast("Couldn't create the card image.", 'err')
    }
  }

  return (
    <>
      <Btn className="w-full" onClick={() => setOpen(true)}>
        <Share2 size={20} strokeWidth={2.5} /> Share breakdown card
      </Btn>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Breakdown card"
        footer={
          <Btn tone="amber" big className="w-full" disabled={shown.length === 0} onClick={share}>
            <Share2 size={22} strokeWidth={3} /> Share card
          </Btn>
        }
      >
        <Segmented
          label="Card period"
          value={span}
          onChange={setSpan}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />
        <Field label={span === 'day' ? 'Day (a working day runs 4 AM to 4 AM)' : `Any date in the ${span}`}>
          <input type="date" className={inputCls} value={date} max={toDateKey(Date.now())} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>

        <canvas ref={canvas} className="w-full rounded-xl border-2 border-ink" style={{ aspectRatio: prefs.tall ? '9 / 16' : '1 / 1', maxHeight: '60dvh', objectFit: 'contain' }} role="img" aria-label={`Breakdown card for ${period.label}`} />

        {all.length === 0 ? (
          <p className="rounded-lg bg-bg-2 px-3 py-2 text-sm font-semibold text-ink-2">Nothing is logged for {period.label} yet. Log a shift or import earnings for it, or pick another date.</p>
        ) : (
          <div>
            <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-ink-2">What to show (the first one is the headline)</div>
            <div className="flex flex-wrap gap-2">
              {all.map((m) => {
                const on = prefs.keys.includes(m.key)
                const hidden = prefs.hideDollars && m.isTotal
                return (
                  <button key={m.key} type="button" aria-pressed={on} disabled={hidden} onClick={() => toggle(m.key)} className={cx('min-h-12 rounded-xl border-2 border-ink px-3 text-sm font-extrabold disabled:opacity-40', on && !hidden ? 'bg-ink text-on-ink' : 'bg-surface')}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <label className="flex min-h-12 items-center justify-between gap-3 text-sm font-extrabold">
          <span>
            Hide dollar totals
            <span className="block text-xs font-semibold text-ink-2">Keeps hours, trips, rates and percentages; leaves out earnings, tips and profit.</span>
          </span>
          <input type="checkbox" className="size-7 shrink-0 accent-[#15803D]" checked={prefs.hideDollars} onChange={(e) => setCardPrefs({ ...prefs, hideDollars: e.target.checked })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Segmented
            label="Card shape"
            value={prefs.tall ? 'tall' : 'square'}
            onChange={(v) => setCardPrefs({ ...prefs, tall: v === 'tall' })}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'tall', label: 'Story' },
            ]}
          />
          <Segmented
            label="Card colours"
            value={prefs.dark ? 'dark' : 'light'}
            onChange={(v) => setCardPrefs({ ...prefs, dark: v === 'dark' })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <p className="text-xs font-semibold text-ink-2">Cards never include addresses, rider details or your plate. Your choices here are remembered.</p>
      </Sheet>
    </>
  )
}
