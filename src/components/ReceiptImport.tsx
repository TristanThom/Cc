import { Plus, ReceiptText } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { money } from '../lib/engine'
import { toDateKey } from '../lib/hours'
import { isNative } from '../lib/native'
import { keepForCheck, readPicture } from '../lib/ocr'
import { OfferCapture } from '../lib/offers'
import { parseReceipt, type ReceiptDraft } from '../lib/receipt'
import { toast, useStore } from '../lib/store'
import type { Category } from '../lib/types'
import { Btn, cx, ErrorText, Field, inputCls, Sheet } from './ui'

const KIND_WORDS: Record<NonNullable<ReceiptDraft['kind']>, string[]> = { fuel: ['fuel', 'gas'], wash: ['wash'], toll: ['toll', 'parking'], maintenance: ['maintenance', 'tire', 'brake'] }

function categoryFor(kind: ReceiptDraft['kind'], cats: Category[]): string {
  const hit = kind ? cats.find((c) => KIND_WORDS[kind].some((w) => c.name.toLowerCase().includes(w))) : undefined
  return hit?.name ?? cats[0]?.name ?? ''
}

/**
 * "Scan receipt": the driver photographs or picks a receipt (or a pump display), the text is
 * read on the phone, and the expense is shown for review. The photo is kept with the expense.
 */
export default function ReceiptImport({ vehicleId }: { vehicleId: string }) {
  const categories = useStore((s) => s.categories)
  const saveTxn = useStore((s) => s.saveTxn)
  const cats = useMemo(() => categories.filter((c) => c.type === 'expense' && !c.hidden), [categories])
  const fileRef = useRef<HTMLInputElement>(null)
  const image = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [category, setCategory] = useState('')
  const [gallons, setGallons] = useState('')
  const [note, setNote] = useState('')
  const [found, setFound] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)

  const onFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const { ocr, base64 } = await readPicture(file, 0, '__WAYPOINT_TEST_RECEIPT')
      const r = parseReceipt(ocr)
      void keepForCheck(base64, 'receipt', ocr, r)
      image.current = base64
      setAmount(r.total !== null ? r.total.toFixed(2) : '')
      setDate(r.date ? `${r.date.year}-${String(r.date.month).padStart(2, '0')}-${String(r.date.day).padStart(2, '0')}` : toDateKey(Date.now()))
      setCategory(categoryFor(r.kind, cats))
      setGallons(r.gallons !== null ? String(r.gallons) : '')
      setNote(r.merchant)
      setFound([r.total !== null && 'total', r.date && 'date', r.gallons !== null && 'gallons', r.merchant && 'merchant'].filter((x): x is string => !!x))
      setErr(r.total === null ? "Couldn't read a total from that photo. Type the amount in, or retake it with the receipt flat and well lit. Pump displays often need typing." : null)
      setOpen(true)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't read that photo.", 'err')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const n = Number(amount)
    const g = Number(gallons)
    const [y, m, d] = date.split('-').map(Number)
    const ts = new Date(y, m - 1, d, 12).getTime()
    if (!(n > 0)) return setErr('Enter the amount paid.')
    if (!category) return setErr('Pick a category.')
    if (!Number.isFinite(ts) || ts > Date.now() + 86_400_000) return setErr("Pick a valid date that isn't in the future.")
    if (gallons !== '' && !(g > 0 && g < 200)) return setErr('Gallons should be a number like 9.412, or left empty.')
    let receipt: string | undefined
    if (isNative && image.current) {
      try {
        receipt = (await OfferCapture.saveImage({ base64: image.current, kind: 'receipt' })).name
      } catch {
        toast("Saved the expense, but the photo couldn't be kept.", 'err')
      }
    }
    saveTxn({ vehicleId, type: 'expense', category, amount: Math.round(n * 100) / 100, ts, note: note.trim(), gallons: gallons !== '' ? g : undefined, receipt })
    toast('Expense added')
    setOpen(false)
  }

  const g = Number(gallons)
  const n = Number(amount)

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
      <Btn className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
        <ReceiptText size={20} strokeWidth={2.5} /> {busy ? 'Reading receipt…' : 'Scan receipt'}
      </Btn>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add expense from receipt"
        footer={
          <Btn tone="ink" big className="w-full" onClick={save}>
            <Plus size={22} strokeWidth={3} /> Add expense{n > 0 ? ` · ${money(n)}` : ''}
          </Btn>
        }
      >
        <p className="text-sm font-semibold text-ink-2">
          {found.length ? `Read from the photo: ${found.join(', ')}. ` : ''}Check each field before adding. {isNative ? 'The photo is kept with the expense on this phone.' : ''}
        </p>
        <Field label="Amount paid">
          <span className="relative block">
            <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black">$</span>
            <input className={cx(inputCls, 'num pl-8 text-lg')} inputMode="decimal" aria-label="Amount paid" value={amount} onChange={(e) => (setAmount(e.target.value.replace(/[^\d.]/g, '').slice(0, 9)), setErr(null))} />
          </span>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" className={inputCls} value={date} max={toDateKey(Date.now())} onChange={(e) => (setDate(e.target.value), setErr(null))} />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Gallons (fuel only)" hint={g > 0 && n > 0 ? `${money(n / g)} per gallon` : 'Leave empty if this is not fuel. Used for miles per gallon.'}>
          <input className={cx(inputCls, 'num')} inputMode="decimal" value={gallons} placeholder="e.g. 9.412" onChange={(e) => (setGallons(e.target.value.replace(/[^\d.]/g, '').slice(0, 7)), setErr(null))} />
        </Field>
        <Field label="Note">
          <input className={inputCls} value={note} maxLength={80} placeholder="Where it was bought" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorText>{err}</ErrorText>
      </Sheet>
    </>
  )
}
