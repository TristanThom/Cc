import { CalendarDays, ChevronDown, Eye, EyeOff, Plus, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Btn, Card, Confirm, cx, ErrorText, Field, inputCls, Keypad, Pill, Segmented, Sheet, Swatches } from '../components/ui'
import { SWATCHES } from '../lib/defaults'
import { buildLedger, inPeriod, listPeriods, mileTotals, money, moneyTotals, num, periodFor, relDate, signedMoney, toLocalInput, type Period, type PeriodMode } from '../lib/engine'
import { toast, useNow, useStore, useVehicle } from '../lib/store'
import type { Txn, TxnType, Vehicle } from '../lib/types'

export default function Income() {
  const v = useVehicle()
  const txns = useStore((s) => s.txns)
  const shifts = useStore((s) => s.shifts)
  const categories = useStore((s) => s.categories)
  const { rate } = useStore((s) => s.settings)
  const now = useNow(30_000)
  const [mode, setMode] = useState<PeriodMode>('week')
  const [anchor, setAnchor] = useState<number | null>(null) // null = follow "now"
  const [picker, setPicker] = useState(false)
  const [view, setView] = useState<'log' | 'breakdown'>('log')
  const [editing, setEditingRaw] = useState<Txn | 'new'>('new')
  const [txnOpen, setTxnOpen] = useState(false)
  const [txnKey, setTxnKey] = useState(0)
  const setEditing = (t: Txn | 'new') => (setEditingRaw(t), setTxnKey((k) => k + 1), setTxnOpen(true))

  const ledger = useMemo(() => (v ? buildLedger(v, shifts) : []), [v, shifts])
  if (!v) return null
  const period = periodFor(mode, anchor ?? now)
  const isCurrent = inPeriod(now, period)
  const totals = moneyTotals(txns, v.id, period)
  const shield = mileTotals(ledger, period, now).business * rate
  const list = txns.filter((t) => t.vehicleId === v.id && inPeriod(t.ts, period)).sort((a, b) => b.ts - a.ts)
  const colorOf = (t: Txn) => categories.find((c) => c.type === t.type && c.name === t.category)?.color ?? (t.type === 'income' ? '#15803D' : '#B91C1C')

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="flex min-h-16 w-full items-center justify-center gap-2 border-b-2 border-ink bg-bg-2 px-3 active:bg-surface"
          aria-label={`Change period. Showing ${period.label}`}
        >
          <CalendarDays size={20} strokeWidth={2.5} />
          <span className="text-center leading-tight">
            <span className="block text-[10px] font-extrabold uppercase tracking-widest text-ink-2">
              {mode === 'week' ? (isCurrent ? 'This week' : 'Week') : isCurrent ? 'This month' : 'Month'}
            </span>
            <span className="num text-base font-black">{period.label}</span>
          </span>
          <ChevronDown size={20} strokeWidth={3} />
        </button>
        <div className="grid grid-cols-[1fr_1fr_1.3fr] divide-x-2 divide-ink text-center">
          <div className="px-1 py-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-2">Income</div>
            <div className="num mt-1 text-[clamp(.95rem,4.4vw,1.4rem)] font-black text-go-text">+{money(totals.income)}</div>
          </div>
          <div className="px-1 py-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-2">Expenses</div>
            <div className="num mt-1 text-[clamp(.95rem,4.4vw,1.4rem)] font-black text-stop-text">-{money(totals.expense)}</div>
          </div>
          <div className="bg-go-soft px-1 py-3">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-ink-2">Net Profit</div>
            <div className={cx('num mt-1 text-[clamp(.95rem,4.4vw,1.4rem)] font-black', totals.net < 0 ? 'text-stop-text' : 'text-ink')}>{signedMoney(totals.net).replace('+', '')}</div>
            <div className="mt-0.5 whitespace-nowrap text-[11px] font-extrabold tabular-nums tracking-tight text-go-text">Tax Shield: +{money(shield)}</div>
          </div>
        </div>
      </Card>

      <Btn tone="amber" big className="w-full" onClick={() => setEditing('new')}>
        <Plus size={24} strokeWidth={3.5} /> Add Transaction
      </Btn>

      <Card>
        <div className="flex items-center justify-between gap-3 p-3">
          <h2 className="text-base font-black">Recent Activity</h2>
          <Segmented
            label="Activity view"
            className="w-48"
            value={view}
            onChange={setView}
            options={[
              { value: 'log', label: 'Log' },
              { value: 'breakdown', label: 'Breakdown' },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <p className="border-t-2 border-ink px-4 py-8 text-center text-sm font-bold text-ink-2">
            No transactions in this period yet.
            <br />
            Tap <b className="text-ink">Add Transaction</b> to log a payout or expense.
          </p>
        ) : view === 'log' ? (
          <ul className="divide-y-2 divide-line border-t-2 border-ink">
            {list.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setEditing(t)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left active:bg-bg-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Pill color={colorOf(t)}>{t.category}</Pill>
                      <span className="shrink-0 text-xs font-bold text-ink-2">{relDate(t.ts, now)}</span>
                    </span>
                    {t.note && <span className="mt-1 block truncate text-sm font-semibold text-ink-2">{t.note}</span>}
                  </span>
                  <span className={cx('num shrink-0 text-lg font-black', t.type === 'income' ? 'text-go-text' : 'text-stop-text')}>
                    {t.type === 'income' ? '+' : '-'}
                    {money(t.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Breakdown list={list} colorOf={colorOf} />
        )}
      </Card>

      <PeriodPicker
        open={picker}
        onClose={() => setPicker(false)}
        vehicle={v}
        mode={mode}
        setMode={setMode}
        selected={period}
        onPick={(ts) => {
          setAnchor(inPeriod(Date.now(), periodFor(mode, ts)) ? null : ts)
          setPicker(false)
        }}
      />
      <TxnSheet key={txnKey} open={txnOpen} target={editing} onClose={() => setTxnOpen(false)} vehicleId={v.id} defaultTs={isCurrent ? null : Math.min(period.end - 1, Date.now())} />
    </div>
  )
}

/* ----------------------------- Breakdown --------------------------- */

function Breakdown({ list, colorOf }: { list: Txn[]; colorOf: (t: Txn) => string }) {
  const groups = (['income', 'expense'] as TxnType[]).map((type) => {
    const map = new Map<string, { amount: number; color: string; count: number }>()
    let total = 0
    for (const t of list) {
      if (t.type !== type) continue
      const g = map.get(t.category) ?? { amount: 0, color: colorOf(t), count: 0 }
      g.amount += t.amount
      g.count++
      total += t.amount
      map.set(t.category, g)
    }
    return { type, total, rows: [...map.entries()].sort((a, b) => b[1].amount - a[1].amount) }
  })
  return (
    <div className="space-y-5 border-t-2 border-ink p-4">
      {groups.map((g) => (
        <div key={g.type}>
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-ink-2">{g.type === 'income' ? 'Income by source' : 'Expenses by category'}</h3>
            <span className={cx('num text-sm font-black', g.type === 'income' ? 'text-go-text' : 'text-stop-text')}>{money(g.total)}</span>
          </div>
          {g.rows.length === 0 && <p className="mt-2 text-sm font-bold text-ink-2">Nothing logged.</p>}
          <ul className="mt-2 space-y-3">
            {g.rows.map(([name, r]) => {
              const pct = g.total ? (r.amount / g.total) * 100 : 0
              return (
                <li key={name}>
                  <div className="flex items-center justify-between gap-2 text-sm font-extrabold">
                    <span className="truncate">
                      {name} <span className="font-bold text-ink-2">· {r.count}</span>
                    </span>
                    <span className="num shrink-0">
                      {money(r.amount)} <span className="text-ink-2">{pct.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-4 overflow-hidden rounded-full border-2 border-ink bg-bg-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${name} share`}>
                    <div className="h-full" style={{ width: `${pct}%`, background: r.color }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/* --------------------------- Period picker ------------------------- */

function PeriodPicker({
  open,
  onClose,
  vehicle,
  mode,
  setMode,
  selected,
  onPick,
}: {
  open: boolean
  onClose: () => void
  vehicle: Vehicle
  mode: PeriodMode
  setMode: (m: PeriodMode) => void
  selected: Period
  onPick: (ts: number) => void
}) {
  const txns = useStore((s) => s.txns)
  const shifts = useStore((s) => s.shifts)
  const unit = useStore((s) => s.settings.unit)
  const rows = useMemo(() => {
    if (!open) return []
    const now = Date.now()
    const mine = txns.filter((t) => t.vehicleId === vehicle.id)
    const ledger = buildLedger(vehicle, shifts)
    const earliest = Math.min(now, ...mine.map((t) => t.ts), ...shifts.filter((s) => s.vehicleId === vehicle.id).map((s) => s.startTs))
    return listPeriods(mode, now, earliest, mode === 'week' ? 12 : 6).map((p) => ({
      p,
      net: moneyTotals(mine, vehicle.id, p).net,
      miles: mileTotals(ledger, p, now).business,
      current: inPeriod(now, p),
    }))
  }, [open, mode, txns, shifts, vehicle])

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'week' ? 'Select week' : 'Select month'}>
      <Segmented
        label="Period type"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'week', label: 'Weekly' },
          { value: 'month', label: 'Monthly' },
        ]}
      />
      <Field label="Jump to date" hint={mode === 'week' ? 'Opens the Monday 4:00 AM ET payout week containing that date.' : 'Opens the month containing that date.'}>
        <input
          type="date"
          className={inputCls}
          max={new Date().toLocaleDateString('en-CA')}
          onChange={(e) => {
            if (!e.target.value) return
            const [y, m, d] = e.target.value.split('-').map(Number)
            // Noon local time on the chosen day keeps it clear of the 4 AM boundary.
            onPick(new Date(y, m - 1, d, 12).getTime())
          }}
        />
      </Field>
      <ul className="space-y-2">
        {rows.map(({ p, net, miles, current }) => {
          const on = p.start === selected.start
          return (
            <li key={p.start}>
              <button
                type="button"
                onClick={() => onPick(p.start)}
                aria-current={on}
                className={cx('flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border-2 border-ink px-3 py-2 text-left', on ? 'bg-ink text-on-ink' : 'bg-surface active:bg-bg-2')}
              >
                <span className="min-w-0">
                  <span className="num block truncate text-sm font-black">{p.label}</span>
                  <span className={cx('num text-xs font-bold', on ? 'text-on-ink/80' : 'text-ink-2')}>
                    {current ? 'Current · ' : ''}
                    {num(miles)} business {unit}
                  </span>
                </span>
                <span className={cx('num shrink-0 text-base font-black', on ? 'text-on-ink' : net < 0 ? 'text-stop-text' : net > 0 ? 'text-go-text' : 'text-ink-2')}>{net === 0 ? money(0) : signedMoney(net)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

/* -------------------------- Transaction sheet ---------------------- */

const CHIPS: Record<TxnType, number[]> = { income: [25, 50, 100, 200], expense: [20, 35, 50, 75] }

function TxnSheet({ open, target, onClose, vehicleId, defaultTs }: { open: boolean; target: Txn | 'new'; onClose: () => void; vehicleId: string; defaultTs: number | null }) {
  const categories = useStore((s) => s.categories)
  const { saveTxn, deleteTxn } = useStore.getState()
  const existing = target !== 'new' ? target : null
  const [type, setType] = useState<TxnType>(existing?.type ?? 'income')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [when, setWhen] = useState(toLocalInput(existing?.ts ?? defaultTs ?? Date.now()))
  const [manage, setManage] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const options = categories.filter((c) => c.type === type && (!c.hidden || c.name === existing?.category))
  useEffect(() => {
    if (!options.some((c) => c.name === category)) setCategory(options[0]?.name ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, categories])

  const n = Number(amount)
  const save = () => {
    const ts = new Date(when).getTime()
    if (!(n > 0)) return setErr('Enter an amount greater than $0.')
    if (!category) return setErr('Pick a category.')
    if (!Number.isFinite(ts)) return setErr('Pick a valid date.')
    saveTxn({ id: existing?.id, vehicleId, type, category, amount: Math.round(n * 100) / 100, ts, note: note.trim() })
    toast(`${type === 'income' ? 'Income' : 'Expense'} saved`)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={manage ? `Manage ${type} options` : existing ? 'Edit transaction' : 'Add transaction'}
      footer={
        manage ? (
          <Btn tone="ink" className="w-full" onClick={() => setManage(false)}>
            Done
          </Btn>
        ) : (
          <div className="flex gap-2">
            {existing && (
              <Btn
                tone="danger"
                aria-label="Delete transaction"
                onClick={() => {
                  deleteTxn(existing.id)
                  toast('Transaction deleted')
                  onClose()
                }}
              >
                <Trash2 size={20} />
              </Btn>
            )}
            <Btn tone={type === 'income' ? 'go' : 'ink'} big className="flex-1" onClick={save}>
              Save {type === 'income' ? 'Income' : 'Expense'}
            </Btn>
          </div>
        )
      }
    >
      {manage ? (
        <CategoryManager type={type} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Transaction type">
            {(['income', 'expense'] as TxnType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={type === t}
                onClick={() => (setType(t), setErr(null))}
                className={cx(
                  'min-h-14 rounded-xl border-2 border-ink text-lg font-black capitalize',
                  type === t ? (t === 'income' ? 'bg-go-dark text-white' : 'bg-stop text-white') : 'bg-surface',
                )}
              >
                {t === 'income' ? '+ Income' : '− Expense'}
              </button>
            ))}
          </div>

          <div className={cx('num rounded-xl border-2 border-ink px-4 py-3 text-center text-4xl font-black', type === 'income' ? 'bg-go-soft text-go-text' : 'bg-stop-soft text-stop-text')} aria-live="polite">
            {type === 'income' ? '+' : '-'}${amount || '0'}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {CHIPS[type].map((c) => (
              <button key={c} type="button" onClick={() => (setAmount(String(Math.round(((Number(amount) || 0) + c) * 100) / 100)), setErr(null))} className="num min-h-12 rounded-xl border-2 border-ink bg-bg-2 text-sm font-black active:bg-ink active:text-on-ink">
                +${c}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide text-ink-2">{type === 'income' ? 'Income source' : 'Expense category'}</span>
              <button type="button" onClick={() => setManage(true)} className="inline-flex min-h-12 items-center gap-1 rounded-lg px-2 text-sm font-extrabold underline">
                <Settings2 size={16} strokeWidth={2.5} /> Manage
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {options.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.name}
                  onClick={() => setCategory(c.name)}
                  className={cx('flex min-h-12 items-center gap-2 rounded-xl border-2 border-ink px-3 text-left text-sm font-extrabold', category === c.name ? 'bg-ink text-on-ink' : 'bg-surface')}
                >
                  <span className="size-3 shrink-0 rounded-full border border-white" style={{ background: c.color }} />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
              <button type="button" onClick={() => setManage(true)} className="flex min-h-12 items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink bg-bg-2 text-sm font-extrabold">
                <Plus size={16} strokeWidth={3} /> Custom
              </button>
            </div>
          </div>

          <Keypad value={amount} onChange={(x) => (setAmount(x), setErr(null))} decimal maxLen={7} />
          <ErrorText>{err}</ErrorText>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date & time">
              <input type="datetime-local" className={inputCls} value={when} max={toLocalInput(Date.now())} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weekly payout" maxLength={80} />
            </Field>
          </div>
        </>
      )}
    </Sheet>
  )
}

function CategoryManager({ type }: { type: TxnType }) {
  const categories = useStore((s) => s.categories)
  const { addCategory, toggleCategory, removeCategory } = useStore.getState()
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[7])
  const [err, setErr] = useState<string | null>(null)
  const [del, setDel] = useState<string | null>(null)
  return (
    <>
      <ul className="space-y-2">
        {categories.filter((c) => c.type === type).map((c) => (
          <li key={c.id} className={cx('flex items-center gap-2 rounded-xl border-2 border-ink p-1 pl-3', c.hidden && 'bg-bg-2')}>
            <span className="size-4 shrink-0 rounded-full border-2 border-ink" style={{ background: c.color }} />
            <span className={cx('flex-1 truncate font-extrabold', c.hidden && 'text-ink-2 line-through')}>{c.name}</span>
            <button type="button" onClick={() => toggleCategory(c.id)} aria-label={c.hidden ? `Show ${c.name}` : `Hide ${c.name}`} className="grid size-12 place-items-center rounded-lg active:bg-bg-2">
              {c.hidden ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            {!c.builtin && (
              <button type="button" onClick={() => setDel(c.id)} aria-label={`Delete ${c.name}`} className="grid size-12 place-items-center rounded-lg text-stop-text active:bg-stop-soft">
                <Trash2 size={20} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="space-y-3 rounded-xl border-2 border-dashed border-ink p-3">
        <Field label={`New custom ${type} ${type === 'income' ? 'source' : 'category'}`}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'income' ? 'e.g. Referral bonus' : 'e.g. Phone plan'} maxLength={24} />
        </Field>
        <Swatches value={color} onChange={setColor} />
        <ErrorText>{err}</ErrorText>
        <Btn
          tone="amber"
          className="w-full"
          onClick={() => {
            const e = addCategory(type, name, color)
            setErr(e)
            if (!e) setName('')
          }}
        >
          <Plus size={18} strokeWidth={3} /> Add option
        </Btn>
      </div>
      <Confirm open={del !== null} onClose={() => setDel(null)} title="Delete option?" body="Existing transactions keep their label. This only removes it from the picker." action="Delete" onConfirm={() => del && removeCategory(del)} />
    </>
  )
}
