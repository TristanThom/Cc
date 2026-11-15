import { Flag, ImageUp, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { mergeGroups, parseEarnings, resolveDate, type EarningsGroup, type EarningsStats, type OcrResult } from '../lib/earnings'
import { fmtDuration, money, weekEnd, weekStart } from '../lib/engine'
import { toDateKey, weekKey } from '../lib/hours'
import { isNative } from '../lib/native'
import { keepForCheck, readPicture } from '../lib/ocr'
import { OfferCapture } from '../lib/offers'
import { toast, useStore } from '../lib/store'
import type { Category, PlatformStat, Txn } from '../lib/types'
import { Btn, cx, ErrorText, Field, inputCls, Segmented, Sheet } from './ui'

interface Draft {
  id: number
  /** The app these numbers belong to; also the income category the earnings are filed under. */
  app: string
  detected: boolean
  period: 'day' | 'week'
  date: string // yyyy-mm-dd
  dated: boolean
  include: boolean
  total: string
  tips: string
  netFare: number | null
  promotions: number | null
  stats: EarningsStats
}

const DAY = 86_400_000
const noon = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

const statChips = (s: EarningsStats): string[] =>
  [
    s.onlineMin !== undefined && `Online ${fmtDuration(s.onlineMin)}`,
    s.bookedMin !== undefined && `Booked ${fmtDuration(s.bookedMin)}`,
    s.bookedMi !== undefined && `${s.bookedMi} booked mi`,
    s.trips !== undefined && `${s.trips} trips`,
    s.rejected !== undefined && `${s.rejected} rejected`,
    s.tipRides !== undefined && `${s.tipRides} tipped`,
  ].filter((x): x is string => !!x)

/** What a complete record would have that these screenshots did not show, and where to find it. */
function missingInfo(d: Draft): { items: string[]; where: string } | null {
  const items = [
    d.total === '' && 'earnings total',
    d.tips === '' && 'tips',
    d.stats.onlineMin === undefined && 'online time',
    d.stats.trips === undefined && 'trips',
    d.app === 'Lyft' && d.stats.bookedMin === undefined && 'booked time',
  ].filter((x): x is string => !!x)
  if (items.length === 0) return null
  const where = d.app === 'Lyft' ? "Lyft's day screen has the total; its Driving stats and Tip stats screens have the rest." : d.app === 'Uber' ? "Uber's earnings screen has them: Stats near the top, and tips under Breakdown further down." : ''
  return { items, where }
}

/** Turns reviewed drafts into the income entries and app stats to save. */
export function buildImport(drafts: Draft[], vehicleId: string, splitTips: boolean, cats: Category[], now: number) {
  const txns: (Omit<Txn, 'id'> & { importKey: string })[] = []
  const stats: Omit<PlatformStat, 'id' | 'updatedAt'>[] = []
  const dropKeys: string[] = []
  const tipsCat = cats.find((c) => c.name.toLowerCase().includes('tip'))?.name
  for (const d of drafts) {
    const dateKey = d.period === 'week' ? weekKey(noon(d.date)) : d.date
    // A week's money is dated on its last day (or today, while the week is still running).
    const ts = d.period === 'week' ? Math.min(weekEnd(weekStart(noon(d.date))) - 16 * 3_600_000, now) : noon(d.date)
    const base = `${d.app}|${d.period}|${dateKey}`
    const total = Number(d.total)
    const tips = Number(d.tips)
    const hasTips = d.tips !== '' && tips > 0
    dropKeys.push(`${base}|earn`, `${base}|tips`)
    if (d.include && total > 0) {
      const parts = [d.netFare !== null && `net fare ${money(d.netFare)}`, d.promotions !== null && `promotions ${money(d.promotions)}`, hasTips && `tips ${money(tips)}`].filter(Boolean)
      const note = `From screenshot${d.period === 'week' ? ' · week' : ''}${parts.length ? ' · ' + parts.join(', ') : ''}`
      const split = splitTips && hasTips && tips < total && !!tipsCat
      txns.push({ vehicleId, type: 'income', category: d.app, amount: Math.round((split ? total - tips : total) * 100) / 100, ts, note, importKey: `${base}|earn` })
      if (split) txns.push({ vehicleId, type: 'income', category: tipsCat, amount: Math.round(tips * 100) / 100, ts, note: `From screenshot · ${d.app} tips`, importKey: `${base}|tips` })
    }
    stats.push({ vehicleId, app: d.app, period: d.period, date: dateKey, earnings: d.include && total > 0 ? total : undefined, tips: hasTips ? tips : undefined, ...d.stats })
  }
  return { txns, stats, dropKeys }
}

/**
 * "Import from screenshots": the driver picks one or more screenshots of earnings or stats
 * screens, the text is read on the phone, and what was found is shown for review. Screenshots
 * of the same app and day are combined into one record.
 */
export default function EarningsImport({ vehicleId }: { vehicleId: string }) {
  const categories = useStore((s) => s.categories)
  const splitTips = useStore((s) => s.settings.splitTips ?? false)
  const hints = useStore((s) => s.settings.importHints ?? true)
  const { saveImport, setSplitTips, setImportHints } = useStore.getState()
  const cats = useMemo(() => categories.filter((c) => c.type === 'income' && !c.hidden), [categories])
  const fileRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const raw = useRef<OcrResult[]>([])
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)

  const draftOf = (g: EarningsGroup, now: number): Draft => ({
    id: nextId.current++,
    app: (g.platform && cats.find((c) => c.name.toLowerCase() === g.platform!.toLowerCase())?.name) || g.platform || cats[0]?.name || 'Earnings',
    detected: g.platform !== null,
    period: g.period,
    date: toDateKey(resolveDate(g.date, now)),
    dated: g.date !== null,
    include: g.total !== null,
    total: g.total !== null ? g.total.toFixed(2) : '',
    tips: g.tips !== null ? g.tips.toFixed(2) : '',
    netFare: g.netFare,
    promotions: g.promotions,
    stats: g.stats,
  })

  const logForImprovement = async (reason: string) => {
    if (!isNative) return
    const json = JSON.stringify({ t: Date.now(), type: 'import_ocr', pkg: 'com.waypoint.app', reason, images: raw.current.map((r) => ({ size: `${r.width}x${r.height}`, lines: r.lines.map((l) => [l.text, Math.round(l.x), Math.round(l.y), Math.round(l.h)]) })) })
    await OfferCapture.logNote({ json }).catch(() => {})
  }

  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (files.length === 0) return
    const found: EarningsGroup[] = []
    raw.current = []
    try {
      for (let i = 0; i < files.length; i++) {
        setBusy(files.length > 1 ? `Reading ${i + 1} of ${files.length}…` : 'Reading screenshot…')
        const { ocr, base64 } = await readPicture(files[i], i, '__WAYPOINT_TEST_OCR')
        raw.current.push(ocr)
        const groups = parseEarnings(ocr)
        found.push(...groups)
        void keepForCheck(base64, 'earnings', ocr, groups)
      }
    } catch (e) {
      setBusy('')
      return toast(e instanceof Error && e.message ? e.message : "Couldn't read that image.", 'err')
    }
    setBusy('')
    const { groups, conflicts } = mergeGroups(found)
    const now = Date.now()
    if (groups.length === 0) {
      void logForImprovement('nothing found')
      setDrafts([{ id: nextId.current++, app: cats[0]?.name ?? 'Earnings', detected: false, period: 'day', date: toDateKey(now), dated: false, include: true, total: '', tips: '', netFare: null, promotions: null, stats: {} }])
      setNotes([])
      setErr("Couldn't find earnings or stats in " + (files.length > 1 ? 'those images' : 'that image') + '. You can type the amount in below. What was read has been saved to the capture log so this kind of screen can be added.')
    } else {
      setDrafts(groups.map((g) => draftOf(g, now)))
      setNotes(conflicts)
      setErr(null)
    }
    setOpen(true)
  }

  const patch = (id: number, p: Partial<Draft>) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)))
    setErr(null)
  }

  const save = () => {
    const now = Date.now()
    for (const d of drafts) {
      const ts = noon(d.date)
      if (!Number.isFinite(ts)) return setErr('Pick a valid date.')
      if (ts > now + DAY) return setErr("The date can't be in the future.")
      if (d.include && !(Number(d.total) > 0)) return setErr(`Enter the ${d.app} earnings total, or untick it.`)
      if (d.tips !== '' && Number(d.tips) > Number(d.total || Infinity)) return setErr(`${d.app} tips can't be more than the total.`)
    }
    const useful = drafts.filter((d) => (d.include && Number(d.total) > 0) || Object.keys(d.stats).length > 0 || d.tips !== '')
    if (useful.length === 0) return setErr('There is nothing to save yet.')
    const out = buildImport(useful, vehicleId, splitTips, cats, now)
    saveImport(out.txns, out.stats, out.dropKeys)
    toast(`Saved ${useful.length} ${useful.length === 1 ? 'record' : 'records'}`)
    setOpen(false)
  }

  const saving = drafts.filter((d) => d.include && Number(d.total) > 0)
  const sum = saving.reduce((a, d) => a + Number(d.total), 0)

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
      <Btn className="w-full" disabled={!!busy} onClick={() => fileRef.current?.click()}>
        <ImageUp size={20} strokeWidth={2.5} /> {busy || 'Import earnings'}
      </Btn>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Import earnings"
        footer={
          <Btn tone="go" big className="w-full" onClick={save}>
            <Plus size={22} strokeWidth={3} /> Save{saving.length ? ` · ${money(sum)}` : ''}
          </Btn>
        }
      >
        <p className="text-sm font-semibold text-ink-2">Check what was read before saving. Screenshots of the same app and day are combined, and importing a day again updates it.</p>
        {notes.map((n) => (
          <p key={n} className="rounded-lg border-2 border-stop bg-stop-soft px-3 py-2 text-sm font-bold text-stop-text">
            {n}
          </p>
        ))}

        {drafts.map((d) => {
          const chips = statChips(d.stats)
          const missing = hints ? missingInfo(d) : null
          return (
            <section key={d.id} className="space-y-3 rounded-xl border-2 border-ink p-3">
              {d.detected ? (
                <h3 className="text-base font-black">{d.app}</h3>
              ) : (
                <Field label="Which app is this from?">
                  <select className={inputCls} value={d.app} onChange={(e) => patch(d.id, { app: e.target.value })}>
                    {cats.map((c) => (
                      <option key={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Segmented
                label={`${d.app} period`}
                value={d.period}
                onChange={(period) => patch(d.id, { period })}
                options={[
                  { value: 'day', label: 'One day' },
                  { value: 'week', label: 'Whole week' },
                ]}
              />
              <Field
                label={d.period === 'week' ? 'Any date in that week' : 'Date'}
                hint={d.dated ? 'Read from the screenshot.' : d.period === 'week' ? "The screenshot didn't show a date, so this is this week. Change it if it's an earlier week." : "The screenshot didn't show a date, so this is today."}
              >
                <input type="date" className={inputCls} value={d.date} max={toDateKey(Date.now())} onChange={(e) => patch(d.id, { date: e.target.value, dated: true })} />
              </Field>

              <div className={cx('rounded-xl border-2 p-2', d.include ? 'border-ink' : 'border-line')}>
                <label className="flex min-h-12 items-center gap-3">
                  <input type="checkbox" className="size-7 shrink-0 accent-[#15803D]" checked={d.include} onChange={(e) => patch(d.id, { include: e.target.checked })} aria-label={`Add ${d.app} earnings to income`} />
                  <span className="min-w-0 flex-1 text-sm font-extrabold">
                    Total earnings
                    <span className="block text-xs font-semibold text-ink-2">{d.total === '' && !d.include ? 'Not shown on these screenshots' : 'Tips included'}</span>
                  </span>
                  <span className="relative w-32 shrink-0">
                    <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black">$</span>
                    <input className={cx(inputCls, 'num pl-7 text-right')} inputMode="decimal" aria-label={`${d.app} total`} value={d.total} onChange={(e) => patch(d.id, { total: e.target.value.replace(/[^\d.]/g, '').slice(0, 9), include: true })} />
                  </span>
                </label>
                <label className="mt-2 flex min-h-12 items-center gap-3 border-t-2 border-dashed border-line pt-2">
                  <span className="min-w-0 flex-1 text-sm font-extrabold">Tips in that total</span>
                  <span className="relative w-32 shrink-0">
                    <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black">$</span>
                    <input className={cx(inputCls, 'num pl-7 text-right')} inputMode="decimal" aria-label={`${d.app} tips`} placeholder="0.00" value={d.tips} onChange={(e) => patch(d.id, { tips: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) })} />
                  </span>
                </label>
              </div>

              {chips.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={`${d.app} stats read`}>
                  {chips.map((c) => (
                    <li key={c} className="num rounded-full bg-bg-2 px-2.5 py-1 text-xs font-extrabold">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
              {missing && (
                <p className="rounded-lg bg-bg-2 px-3 py-2 text-xs font-semibold text-ink-2">
                  <b className="text-ink">Not on these screenshots:</b> {missing.items.join(', ')}. You can save without them, or add more screenshots and import again. {missing.where}
                </p>
              )}
            </section>
          )
        })}

        <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-ink px-3 text-sm font-extrabold">
          <span>
            Count tips separately
            <span className="block text-xs font-semibold text-ink-2">Adds tips as their own income entry. Remembered for next time.</span>
          </span>
          <input type="checkbox" className="size-7 shrink-0 accent-[#15803D]" checked={splitTips} onChange={(e) => setSplitTips(e.target.checked)} />
        </label>

        {hints && drafts.some((d) => missingInfo(d)) && (
          <button type="button" onClick={() => setImportHints(false)} className="min-h-12 w-full rounded-xl text-sm font-extrabold text-ink-2 underline">
            Don't point out missing information again
          </button>
        )}
        <ErrorText>{err}</ErrorText>
        {isNative && (
          <Btn
            className="w-full"
            onClick={async () => {
              await logForImprovement('reported wrong')
              toast('Saved what was read to the capture log. Send it with Share log in Settings.')
            }}
          >
            <Flag size={18} strokeWidth={2.5} /> This looks wrong
          </Btn>
        )}
        <p className="text-xs font-semibold text-ink-2">Images are read on this phone and aren't uploaded or kept. A weekly total and that week's daily totals count the same money twice, so import one or the other for each app.</p>
      </Sheet>
    </>
  )
}
