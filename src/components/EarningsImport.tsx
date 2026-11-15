import { ImageUp, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { parseEarnings, resolveDate, type EarningsGroup, type EarningsKind, type OcrResult } from '../lib/earnings'
import { money } from '../lib/engine'
import { isNative } from '../lib/native'
import { OfferCapture } from '../lib/offers'
import { toast, useStore } from '../lib/store'
import type { Category } from '../lib/types'
import { Btn, cx, ErrorText, Field, inputCls, Sheet } from './ui'

interface DraftRow {
  id: number
  label: string
  amount: string
  category: string
  selected: boolean
}
interface DraftGroup {
  title: string
  date: string // yyyy-mm-dd
  dated: boolean // the screenshot showed a date
  rows: DraftRow[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Picks the income category a detected row should default to. */
function categoryFor(kind: EarningsKind, platform: string | null, cats: Category[]): string {
  const has = (name: string) => cats.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name
  const byWord = (word: string) => cats.find((c) => c.name.toLowerCase().includes(word))?.name
  const first = cats[0]?.name ?? ''
  if (kind === 'tips') return byWord('tip') ?? first
  if (kind === 'bonus') return byWord('bonus') ?? byWord('quest') ?? first
  return (platform && has(platform)) ?? first
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function recognise(file: File): Promise<OcrResult> {
  if (isNative) return OfferCapture.recognizeImage({ base64: await fileToBase64(file) })
  // Lets the browser test suite exercise the import flow; real recognition runs in the Android app.
  const test = (window as { __WAYPOINT_TEST_OCR?: OcrResult }).__WAYPOINT_TEST_OCR
  if (test) return test
  throw new Error('Screenshot import reads the image on your phone, so it only works in the Waypoint Android app.')
}

/**
 * "Import from screenshot": the driver picks a screenshot of an earnings screen, the text is
 * read on the phone, and the amounts found are shown for review before anything is saved.
 */
export default function EarningsImport({ vehicleId }: { vehicleId: string }) {
  const categories = useStore((s) => s.categories)
  const txns = useStore((s) => s.txns)
  const saveTxn = useStore((s) => s.saveTxn)
  const cats = useMemo(() => categories.filter((c) => c.type === 'income' && !c.hidden), [categories])
  const fileRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<DraftGroup[]>([])
  const [err, setErr] = useState<string | null>(null)

  const draftFrom = (found: EarningsGroup[]): DraftGroup[] => {
    const now = Date.now()
    const blank = (): DraftRow => ({ id: nextId.current++, label: 'Earnings', amount: '', category: cats[0]?.name ?? '', selected: true })
    if (found.length === 0) return [{ title: 'Earnings', date: toDateInput(now), dated: false, rows: [blank()] }]
    return found.map((g) => ({
      title: g.platform ?? 'Earnings',
      date: toDateInput(resolveDate(g.date, now)),
      dated: g.date !== null,
      rows: g.rows.map((r) => ({ id: nextId.current++, label: r.label, amount: r.amount.toFixed(2), category: categoryFor(r.kind, g.platform, cats), selected: r.selected })),
    }))
  }

  const onFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const found = parseEarnings(await recognise(file))
      setGroups(draftFrom(found))
      setErr(found.length === 0 ? "Couldn't find earnings amounts in that image. You can type one in below, or try a screenshot that shows the total." : null)
      setOpen(true)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't read that image.", 'err')
    } finally {
      setBusy(false)
    }
  }

  const patchRow = (gi: number, id: number, patch: Partial<DraftRow>) =>
    setGroups((gs) => gs.map((g, i) => (i !== gi ? g : { ...g, rows: g.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) })))

  const tsOf = (g: DraftGroup) => {
    const [y, m, d] = g.date.split('-').map(Number)
    return new Date(y, m - 1, d, 12).getTime()
  }
  const picked = groups.flatMap((g) => g.rows.filter((r) => r.selected).map((r) => ({ g, r, n: Number(r.amount) })))
  const total = picked.reduce((a, p) => a + (Number.isFinite(p.n) ? p.n : 0), 0)
  // Same category, amount and calendar day as something already logged: probably imported before.
  const isDuplicate = (g: DraftGroup, r: DraftRow) => {
    const day = new Date(tsOf(g)).toDateString()
    return txns.some((t) => t.vehicleId === vehicleId && t.type === 'income' && t.category === r.category && Math.abs(t.amount - Number(r.amount)) < 0.005 && new Date(t.ts).toDateString() === day)
  }

  const save = () => {
    if (picked.length === 0) return setErr('Tick at least one amount to add.')
    for (const { g, r, n } of picked) {
      if (!(n > 0)) return setErr(`Enter an amount greater than $0 for "${r.label}".`)
      if (!r.category) return setErr('Pick a category for each ticked amount.')
      const ts = tsOf(g)
      if (!Number.isFinite(ts)) return setErr('Pick a valid date.')
      if (ts > Date.now() + 86_400_000) return setErr("The date can't be in the future.")
    }
    for (const { g, r, n } of picked) {
      saveTxn({ vehicleId, type: 'income', category: r.category, amount: Math.round(n * 100) / 100, ts: tsOf(g), note: `From screenshot · ${g.title} ${r.label.toLowerCase()}` })
    }
    toast(`${picked.length} income ${picked.length === 1 ? 'entry' : 'entries'} added`)
    setOpen(false)
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
      <Btn className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
        <ImageUp size={20} strokeWidth={2.5} /> {busy ? 'Reading screenshot…' : 'Import from screenshot'}
      </Btn>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Import earnings"
        footer={
          <Btn tone="go" big className="w-full" onClick={save}>
            <Plus size={22} strokeWidth={3} /> Add {picked.length} {picked.length === 1 ? 'entry' : 'entries'} · {money(total)}
          </Btn>
        }
      >
        <p className="text-sm font-semibold text-ink-2">Check what was read from the screenshot before adding it. Untick anything you don't want, and fix any amount that was misread.</p>
        {groups.map((g, gi) => (
          <section key={gi} className="space-y-3 rounded-xl border-2 border-ink p-3">
            <h3 className="text-base font-black">{g.title}</h3>
            <Field label="Date these earnings are for" hint={g.dated ? 'Read from the screenshot.' : "The screenshot didn't show a single date, so this is today. Change it to the day or week it covers."}>
              <input
                type="date"
                className={inputCls}
                value={g.date}
                max={toDateInput(Date.now())}
                onChange={(e) => (setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, date: e.target.value, dated: true } : x))), setErr(null))}
              />
            </Field>
            <ul className="space-y-2">
              {g.rows.map((r) => (
                <li key={r.id} className={cx('rounded-xl border-2 p-2', r.selected ? 'border-ink' : 'border-line opacity-60')}>
                  <label className="flex min-h-12 items-center gap-3">
                    <input type="checkbox" className="size-7 shrink-0 accent-[#15803D]" checked={r.selected} onChange={(e) => (patchRow(gi, r.id, { selected: e.target.checked }), setErr(null))} />
                    <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{r.label}</span>
                    <span className="relative w-32 shrink-0">
                      <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black">$</span>
                      <input
                        className={cx(inputCls, 'num pl-7 text-right')}
                        inputMode="decimal"
                        aria-label={`${r.label} amount`}
                        value={r.amount}
                        onChange={(e) => (patchRow(gi, r.id, { amount: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) }), setErr(null))}
                      />
                    </span>
                  </label>
                  <select className={cx(inputCls, 'mt-2')} aria-label={`${r.label} category`} value={r.category} onChange={(e) => patchRow(gi, r.id, { category: e.target.value })}>
                    {cats.map((c) => (
                      <option key={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {r.selected && isDuplicate(g, r) && <p className="mt-1 text-xs font-bold text-stop-text">An entry with this category, amount and date already exists. Untick it if you've imported this before.</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <ErrorText>{err}</ErrorText>
        <p className="text-xs font-semibold text-ink-2">The image is read on this phone and isn't uploaded or kept. A weekly total and that week's daily totals count the same money twice, so import one or the other.</p>
      </Sheet>
    </>
  )
}
