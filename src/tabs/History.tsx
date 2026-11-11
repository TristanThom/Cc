import { Camera, Coffee, Download, FileText, Pencil, Printer, Search, Trash2, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BreakStepper, Btn, Card, Confirm, cx, ErrorText, Field, inputCls, Keypad, Pill, Segmented, Sheet } from '../components/ui'
import { isNative, saveFile, standaloneHtml } from '../lib/native'
import { adjustBreaks, buildLedger, fmtDate, fmtDateYear, fmtDuration, fmtRate, fmtTime, grossMinutes, ledgerCsv, money, num, shiftLengthMin, toLocalInput } from '../lib/engine'
import { uid } from '../lib/defaults'
import { toast, useNow, useStore, useVehicle } from '../lib/store'
import type { LedgerEntry, Shift, Vehicle } from '../lib/types'

type Filter = 'all' | 'business' | 'gaps'

export default function History() {
  const v = useVehicle()
  const shifts = useStore((s) => s.shifts)
  const platforms = useStore((s) => s.platforms)
  const { rate, unit } = useStore((s) => s.settings)
  const now = useNow(30_000)
  const [tab, setTab] = useState<'log' | 'tax'>('log')
  const [filter, setFilter] = useState<Filter>('all')
  const [app, setApp] = useState('')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Shift | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [report, setReport] = useState(false)

  const ledger = useMemo(() => (v ? buildLedger(v, shifts) : []), [v, shifts])
  const appNames = useMemo(() => [...new Set([...platforms.map((p) => p.name), ...ledger.flatMap((e) => (e.kind === 'shift' ? e.shift.platforms : []))])], [platforms, ledger])
  if (!v) return null

  const needle = q.trim().toLowerCase()
  const rows = [...ledger].reverse().filter((e) => {
    if (filter === 'business' && e.kind !== 'shift') return false
    if (filter === 'gaps' && e.kind !== 'gap') return false
    if (app && (e.kind !== 'shift' || !e.shift.platforms.includes(app))) return false
    if (!needle) return true
    const hay =
      e.kind === 'shift'
        ? [e.shift.notes, e.shift.platforms.join(' '), e.shift.startOdo, e.shift.endOdo ?? '', fmtDateYear(e.shift.startTs), 'business shift']
        : [e.note, e.startOdo, e.endOdo, e.toTs ? fmtDateYear(e.toTs) : '', 'personal gap']
    return hay.join(' ').toLowerCase().includes(needle)
  })

  const exportCsv = async () => {
    if (!ledger.length) return toast('Nothing to export yet.', 'err')
    const saved = await saveFile(`waypoint-mileage-${v.model.replace(/\W+/g, '-').toLowerCase() || 'vehicle'}-${new Date().toLocaleDateString('en-CA')}.csv`, '﻿' + ledgerCsv(v, ledger, rate, unit, now), 'text/csv;charset=utf-8')
    if (saved) toast('Mileage log exported')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Segmented
        label="History section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'log', label: 'Mileage Log' },
          { value: 'tax', label: 'Tax Summary' },
        ]}
      />

      {tab === 'log' ? (
        <>
          <Card className="space-y-3 p-3">
            <Segmented
              label="Entry filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'business', label: 'Business' },
                { value: 'gaps', label: 'Personal Gaps' },
              ]}
            />
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <label className="relative col-span-2 block sm:col-span-1">
                <Search size={18} strokeWidth={3} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
                <input type="search" className={cx(inputCls, 'pl-10')} placeholder="Search notes, apps, odometer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search mileage log" />
              </label>
              <select className={inputCls} value={app} onChange={(e) => setApp(e.target.value)} aria-label="Filter by gig app">
                <option value="">All gig apps</option>
                {appNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <Btn tone="ink" onClick={exportCsv} aria-label="Export CSV">
                <Download size={18} strokeWidth={3} /> CSV
              </Btn>
            </div>
          </Card>

          {rows.length === 0 ? (
            <Card className="p-8 text-center text-sm font-bold text-ink-2">
              {ledger.length === 0 ? 'No mileage yet. Start your first shift from Home and the continuous log begins here.' : 'No entries match these filters.'}
            </Card>
          ) : (
            <ol className="space-y-3">
              {rows.map((e) => (
                <li key={e.id}>{e.kind === 'shift' ? <ShiftCard e={e} now={now} onEdit={() => (setEdit(e.shift), setEditOpen(true))} /> : <GapCard e={e} />}</li>
              ))}
            </ol>
          )}
          {rows.length > 0 && (
            <p className="num text-center text-xs font-bold text-ink-2">
              {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · chain {num(v.startOdo)} → {num(ledger.length ? chainEnd(ledger) : v.startOdo)} {unit} · 0 unaccounted
            </p>
          )}
        </>
      ) : (
        <TaxSummary vehicle={v} ledger={ledger} now={now} onReport={() => setReport(true)} onCsv={exportCsv} />
      )}

      {edit && <EditShiftSheet key={edit.id} open={editOpen} shift={edit} vehicle={v} onClose={() => setEditOpen(false)} />}
      <TaxReport open={report} onClose={() => setReport(false)} vehicle={v} ledger={ledger} now={now} />
    </div>
  )
}

const chainEnd = (ledger: LedgerEntry[]) => {
  const last = ledger[ledger.length - 1]
  return last.kind === 'shift' ? (last.shift.endOdo ?? last.shift.startOdo) : last.endOdo
}

/* ------------------------------ Cards ----------------------------- */

function OdoRange({ start, end }: { start: number; end: number | null }) {
  return (
    <div className="num flex items-center gap-2 text-sm font-black">
      <span className="rounded-md bg-ink px-2 py-1 text-white">{num(start)}</span>
      <span className="h-0.5 flex-1 bg-ink" />
      <span className={cx('rounded-md px-2 py-1', end === null ? 'border-2 border-dashed border-ink text-ink-2' : 'bg-ink text-white')}>{end === null ? 'in progress' : num(end)}</span>
    </div>
  )
}

function ShiftCard({ e, now, onEdit }: { e: Extract<LedgerEntry, { kind: 'shift' }>; now: number; onEdit: () => void }) {
  const s = e.shift
  const platforms = useStore((st) => st.platforms)
  const { rate, unit } = useStore((st) => st.settings)
  const bump = useStore((st) => st.bumpBreak)
  const live = s.endTs === null
  return (
    <Card className={cx('overflow-hidden', live && 'border-go-dark')}>
      <div className={cx('flex items-center justify-between gap-2 border-b-2 border-ink px-3 py-2', live ? 'bg-go-dark text-white' : 'bg-bg-2')}>
        <div className="min-w-0">
          <div className="truncate text-sm font-black">
            {fmtDate(s.startTs)} · {fmtTime(s.startTs)} – {s.endTs ? fmtTime(s.endTs) : 'now'}
          </div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider">{live ? 'Business · active shift' : 'Business shift'}</div>
        </div>
        <button type="button" onClick={onEdit} aria-label="Edit shift" className={cx('grid size-12 shrink-0 place-items-center rounded-xl border-2', live ? 'border-white' : 'border-ink bg-white')}>
          <Pencil size={18} strokeWidth={2.5} />
        </button>
      </div>
      <div className="space-y-3 p-3">
        <OdoRange start={s.startOdo} end={s.endOdo} />
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label={`Business ${unit}`} value={num(e.miles)} />
          <Stat label="Write-off" value={money(e.miles * rate)} tone="go" />
          <Stat label="Break" value={`${s.breakMin}m`} />
        </div>
        <div className="num rounded-xl bg-ink px-3 py-2 text-center text-base font-black text-white">
          Shift Length: {fmtDuration(shiftLengthMin(s, now))}
          <span className="block text-xs font-bold text-white/70">
            ({fmtDuration(grossMinutes(s, now))} − {s.breakMin}m break)
          </span>
        </div>
        <BreakStepper minutes={s.breakMin} onBump={(d) => bump(s.id, d)} />
        {(s.platforms.length > 0 || s.startPhoto || s.endPhoto) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {s.platforms.map((p) => (
              <Pill key={p} color={platforms.find((x) => x.name === p)?.color ?? '#334155'}>
                {p}
              </Pill>
            ))}
            {(s.startPhoto || s.endPhoto) && (
              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-ink-2">
                <Camera size={14} strokeWidth={3} /> Proof photo
              </span>
            )}
          </div>
        )}
        {s.notes && <p className="rounded-lg bg-bg-2 px-3 py-2 text-sm font-semibold text-ink-2">{s.notes}</p>}
      </div>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'go' }) {
  return (
    <div className="rounded-xl border-2 border-slate-200 px-1 py-2">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-ink-2">{label}</div>
      <div className={cx('num text-lg font-black', tone === 'go' && 'text-go-dark')}>{value}</div>
    </div>
  )
}

function GapCard({ e }: { e: Extract<LedgerEntry, { kind: 'gap' }> }) {
  const unit = useStore((s) => s.settings.unit)
  return (
    <div className="rounded-2xl border-2 border-dashed border-ink-2 bg-bg-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-2">
          <UserRound size={14} strokeWidth={3} /> Personal gap · not deductible
        </span>
        <span className="num text-base font-black">
          {num(e.miles)} {unit}
        </span>
      </div>
      <OdoRange start={e.startOdo} end={e.endOdo} />
      <p className="mt-2 text-xs font-bold text-ink-2">
        {e.note}
        {e.fromTs || e.toTs ? ` · ${e.fromTs ? fmtDate(e.fromTs) : 'start'} → ${e.toTs ? fmtDate(e.toTs) : 'now'}` : ''} · auto-calculated
      </p>
    </div>
  )
}

/* --------------------------- Edit shift ---------------------------- */

function EditShiftSheet({ open, shift, vehicle, onClose }: { open: boolean; shift: Shift; vehicle: Vehicle; onClose: () => void }) {
  const platforms = useStore((s) => s.platforms)
  const unit = useStore((s) => s.settings.unit)
  const { updateShift, deleteShift } = useStore.getState()
  const live = shift.endTs === null
  const [startOdo, setStartOdo] = useState(String(shift.startOdo))
  const [endOdo, setEndOdo] = useState(shift.endOdo === null ? '' : String(shift.endOdo))
  const [field, setField] = useState<'start' | 'end'>(live ? 'start' : 'end')
  const [startAt, setStartAt] = useState(toLocalInput(shift.startTs))
  const [endAt, setEndAt] = useState(shift.endTs ? toLocalInput(shift.endTs) : '')
  const [brk, setBrk] = useState({ breakMin: shift.breakMin, breaks: shift.breaks })
  const [apps, setApps] = useState(shift.platforms)
  const [notes, setNotes] = useState(shift.notes)
  const [err, setErr] = useState<string | null>(null)
  const [del, setDel] = useState(false)
  const now = useNow(30_000)

  // Re-sync when the sheet is reopened for the same shift.
  useEffect(() => {
    if (open) {
      setStartOdo(String(shift.startOdo))
      setEndOdo(shift.endOdo === null ? '' : String(shift.endOdo))
      setBrk({ breakMin: shift.breakMin, breaks: shift.breaks })
      setErr(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const startTs = new Date(startAt).getTime()
  const endTs = live ? null : new Date(endAt).getTime()
  const draft: Shift = { ...shift, startTs: Number.isFinite(startTs) ? startTs : shift.startTs, endTs: live ? null : Number.isFinite(endTs) ? endTs : shift.endTs, ...brk }
  const allApps = [...new Set([...platforms.map((p) => p.name), ...shift.platforms])]

  const save = () => {
    if (!Number.isFinite(startTs) || (!live && !Number.isFinite(endTs))) return setErr('Enter valid start and end times.')
    if (startOdo === '' || (!live && endOdo === '')) return setErr('Enter both odometer readings.')
    const e = updateShift(shift.id, { startOdo: Number(startOdo), endOdo: live ? null : Number(endOdo), startTs, endTs, platforms: apps, notes: notes.trim(), ...brk })
    setErr(e)
    if (!e) {
      toast('Shift updated')
      onClose()
    }
  }

  const odoBtn = (which: 'start' | 'end', val: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setField(which)}
      aria-pressed={field === which}
      className={cx('min-h-16 rounded-xl border-2 border-ink px-2 text-center disabled:opacity-40', field === which ? 'bg-amber' : 'bg-white')}
    >
      <span className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-2">{which} odometer</span>
      <span className="num text-2xl font-black">{val ? num(Number(val)) : '—'}</span>
    </button>
  )

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Edit Shift"
        footer={
          <div className="flex gap-2">
            <Btn tone="danger" aria-label="Delete shift" onClick={() => setDel(true)}>
              <Trash2 size={20} />
            </Btn>
            <Btn tone="amber" big className="flex-1" onClick={save}>
              Save Changes
            </Btn>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {odoBtn('start', startOdo)}
          {odoBtn('end', endOdo, live)}
        </div>
        <p className="num text-center text-sm font-extrabold text-ink-2">
          {live ? 'Shift in progress — end it from Home' : startOdo && endOdo && Number(endOdo) >= Number(startOdo) ? `${num(Number(endOdo) - Number(startOdo))} business ${unit}` : 'End must be at or above start'}
        </p>
        <Keypad value={field === 'start' ? startOdo : endOdo} onChange={(x) => ((field === 'start' ? setStartOdo : setEndOdo)(x), setErr(null))} />

        <div className="rounded-xl border-2 border-ink p-3">
          <BreakStepper minutes={brk.breakMin} onBump={(d) => setBrk(adjustBreaks(draft, d, now, uid))} />
          <div className="num mt-2 border-t-2 border-dashed border-slate-300 pt-2 text-center text-base font-black">
            Shift Length: {fmtDuration(shiftLengthMin(draft, now))}
          </div>
          {brk.breaks.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Breaks">
              {brk.breaks.map((b) => (
                <li key={b.id} className="num inline-flex items-center gap-1 rounded-full bg-bg-2 px-2 py-1 text-xs font-extrabold text-ink-2">
                  <Coffee size={12} strokeWidth={3} /> {b.minutes}m
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start time">
            <input type="datetime-local" className={inputCls} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          {!live && (
            <Field label="End time">
              <input type="datetime-local" className={inputCls} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </Field>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-ink-2">Gig platforms</div>
          <div className="flex flex-wrap gap-2">
            {allApps.map((n) => {
              const on = apps.includes(n)
              return (
                <button key={n} type="button" aria-pressed={on} onClick={() => setApps(on ? apps.filter((x) => x !== n) : [...apps, n])} className={cx('min-h-12 rounded-xl border-2 border-ink px-3 text-sm font-extrabold', on ? 'bg-ink text-white' : 'bg-white')}>
                  {n}
                </button>
              )
            })}
          </div>
        </div>

        <Field label="Notes">
          <textarea className={cx(inputCls, 'py-2')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={280} />
        </Field>
        {(shift.startPhoto || shift.endPhoto) && (
          <div className="flex gap-3">
            {shift.startPhoto && <img src={shift.startPhoto} alt="Start odometer proof" className="h-28 rounded-xl border-2 border-ink object-cover" />}
            {shift.endPhoto && <img src={shift.endPhoto} alt="End odometer proof" className="h-28 rounded-xl border-2 border-ink object-cover" />}
          </div>
        )}
        <ErrorText>{err}</ErrorText>
        <p className="text-xs font-bold text-ink-2">
          Chain start for this vehicle: <span className="num">{num(vehicle.startOdo)}</span>. Readings can't overlap neighbouring shifts — the personal gaps on either side re-calculate automatically.
        </p>
      </Sheet>
      <Confirm
        open={del}
        onClose={() => setDel(false)}
        title="Delete this shift?"
        body={`Its ${unit === 'mi' ? 'miles' : 'kilometres'} fold into the surrounding Personal Gap, so the odometer chain stays unbroken. This can't be undone.`}
        action="Delete shift"
        onConfirm={() => {
          deleteShift(shift.id)
          toast('Shift deleted')
          onClose()
        }}
      />
    </>
  )
}

/* ---------------------------- Tax summary -------------------------- */

interface YearSummary {
  year: number
  business: number
  personal: number
  shifts: number
  lengthMin: number
  breakMin: number
  months: { business: number; personal: number; shifts: number; lengthMin: number }[]
  byApp: Map<string, { miles: number; shifts: number; lengthMin: number }>
}

function summarize(ledger: LedgerEntry[], now: number): YearSummary[] {
  const years = new Map<number, YearSummary>()
  const get = (ts: number) => {
    const y = new Date(ts).getFullYear()
    let s = years.get(y)
    if (!s) {
      s = { year: y, business: 0, personal: 0, shifts: 0, lengthMin: 0, breakMin: 0, months: Array.from({ length: 12 }, () => ({ business: 0, personal: 0, shifts: 0, lengthMin: 0 })), byApp: new Map() }
      years.set(y, s)
    }
    return { s, m: s.months[new Date(ts).getMonth()] }
  }
  for (const e of ledger) {
    if (e.kind === 'gap') {
      const { s, m } = get(e.toTs ?? now)
      s.personal += e.miles
      m.personal += e.miles
      continue
    }
    const { s, m } = get(e.shift.startTs)
    const len = shiftLengthMin(e.shift, now)
    s.business += e.miles
    s.shifts++
    s.lengthMin += len
    s.breakMin += e.shift.breakMin
    m.business += e.miles
    m.shifts++
    m.lengthMin += len
    // Split a multi-app shift evenly so per-app totals add up to the year total.
    const apps = e.shift.platforms.length ? e.shift.platforms : ['Unassigned']
    for (const a of apps) {
      const r = s.byApp.get(a) ?? { miles: 0, shifts: 0, lengthMin: 0 }
      r.miles += e.miles / apps.length
      r.lengthMin += len / apps.length
      r.shifts++
      s.byApp.set(a, r)
    }
  }
  if (!years.size) get(now)
  return [...years.values()].sort((a, b) => b.year - a.year)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pct = (a: number, b: number) => (a + b ? (a / (a + b)) * 100 : 0)

function RatioBar({ business, personal }: { business: number; personal: number }) {
  const p = pct(business, personal)
  return (
    <div>
      <div className="flex h-7 overflow-hidden rounded-lg border-2 border-ink bg-white" role="img" aria-label={`${p.toFixed(1)}% business, ${(100 - p).toFixed(1)}% personal`}>
        <div className="bg-go-dark" style={{ width: `${p}%`, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
        <div className="flex-1 bg-slate-300" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />
      </div>
      <div className="num mt-1 flex justify-between text-xs font-extrabold">
        <span className="text-go-dark">Business {p.toFixed(1)}%</span>
        <span className="text-ink-2">Personal {(business + personal ? 100 - p : 0).toFixed(1)}%</span>
      </div>
    </div>
  )
}

function TaxSummary({ vehicle, ledger, now, onReport, onCsv }: { vehicle: Vehicle; ledger: LedgerEntry[]; now: number; onReport: () => void; onCsv: () => void }) {
  const { rate, unit } = useStore((s) => s.settings)
  const years = useMemo(() => summarize(ledger, now), [ledger, now])
  const [year, setYear] = useState(years[0].year)
  const y = years.find((x) => x.year === year) ?? years[0]
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">
            {y.year} tax year · {vehicle.model}
          </h2>
          {years.length > 1 && (
            <select className={cx(inputCls, 'w-auto')} value={y.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
              {years.map((x) => (
                <option key={x.year}>{x.year}</option>
              ))}
            </select>
          )}
        </div>
        <div className="rounded-xl border-2 border-ink bg-emerald-50 p-4 text-center">
          <div className="text-xs font-extrabold uppercase tracking-widest text-go-dark">Standard mileage deduction</div>
          <div className="num text-4xl font-black text-go-dark">{money(y.business * rate)}</div>
          <div className="num text-sm font-bold text-ink-2">
            {num(y.business)} business {unit} × {fmtRate(rate)}/{unit}
          </div>
        </div>
        <RatioBar business={y.business} personal={y.personal} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={`Business ${unit}`} value={num(y.business)} tone="go" />
          <Stat label={`Personal ${unit}`} value={num(y.personal)} />
          <Stat label="Shifts" value={String(y.shifts)} />
          <Stat label="Shift length" value={fmtDuration(y.lengthMin)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Btn tone="amber" onClick={onReport}>
            <FileText size={18} strokeWidth={2.5} /> Tax Report
          </Btn>
          <Btn onClick={onCsv}>
            <Download size={18} strokeWidth={2.5} /> Export CSV
          </Btn>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <h3 className="border-b-2 border-ink bg-bg-2 px-4 py-2 text-sm font-black">Monthly breakdown</h3>
        <MonthTable y={y} />
      </Card>
    </div>
  )
}

function MonthTable({ y }: { y: YearSummary }) {
  const { rate, unit } = useStore((s) => s.settings)
  const rows = y.months.map((m, i) => ({ m, i })).filter(({ m }) => m.business || m.personal)
  if (!rows.length) return <p className="p-4 text-sm font-bold text-ink-2">No mileage logged this year.</p>
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-right text-sm font-bold">
        <thead className="text-[11px] uppercase tracking-wide text-ink-2">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-2 py-2">Business {unit}</th>
            <th className="px-2 py-2">Personal {unit}</th>
            <th className="px-2 py-2">Shift length</th>
            <th className="px-3 py-2">Deduction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, i }) => (
            <tr key={i} className="border-t border-slate-300">
              <td className="px-3 py-2 text-left font-black">{MONTHS[i]}</td>
              <td className="px-2 py-2">{num(m.business)}</td>
              <td className="px-2 py-2 text-ink-2">{num(m.personal)}</td>
              <td className="px-2 py-2">{fmtDuration(m.lengthMin)}</td>
              <td className="px-3 py-2 font-black text-go-dark">{money(m.business * rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ----------------------------- Tax report -------------------------- */

function ReportBody({ vehicle, y, ledger, now }: { vehicle: Vehicle; y: YearSummary; ledger: LedgerEntry[]; now: number }) {
  const { rate, unit } = useStore((s) => s.settings)
  const entries = ledger.filter((e) => new Date(e.kind === 'shift' ? e.shift.startTs : (e.toTs ?? now)).getFullYear() === y.year)
  const first = entries[0]
  const last = entries[entries.length - 1]
  const odoStart = first ? (first.kind === 'shift' ? first.shift.startOdo : first.startOdo) : vehicle.startOdo
  const odoEnd = last ? (last.kind === 'shift' ? (last.shift.endOdo ?? last.shift.startOdo) : last.endOdo) : vehicle.startOdo
  const th = 'border border-slate-400 bg-slate-100 px-2 py-1 text-left text-[11px] uppercase'
  const td = 'border border-slate-400 px-2 py-1'
  return (
    <div className="space-y-5 text-ink">
      <header className="border-b-4 border-ink pb-3">
        <h1 className="text-2xl font-black">Vehicle Mileage Log &amp; Deduction Report</h1>
        <p className="text-sm font-bold text-ink-2">
          Tax year {y.year} · Standard mileage rate method · Prepared with Waypoint on {fmtDateYear(now)}
        </p>
      </header>

      <table className="w-full border-collapse text-sm font-semibold">
        <tbody>
          <tr>
            <th className={th}>Vehicle</th>
            <td className={td}>{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}</td>
            <th className={th}>License plate</th>
            <td className={td}>{vehicle.plate || '—'}</td>
          </tr>
          <tr>
            <th className={th}>Odometer, first entry</th>
            <td className={cx(td, 'num')}>{num(odoStart)}</td>
            <th className={th}>Odometer, last entry</th>
            <td className={cx(td, 'num')}>{num(odoEnd)}</td>
          </tr>
        </tbody>
      </table>

      <section>
        <h2 className="mb-2 text-base font-black">1. Business vs. personal use</h2>
        <RatioBar business={y.business} personal={y.personal} />
        <table className="num mt-3 w-full border-collapse text-sm font-semibold">
          <tbody>
            <tr><th className={th}>Total {unit} driven</th><td className={td}>{num(y.business + y.personal)}</td></tr>
            <tr><th className={th}>Business {unit}</th><td className={td}>{num(y.business)} ({pct(y.business, y.personal).toFixed(1)}%)</td></tr>
            <tr><th className={th}>Personal / commuting {unit}</th><td className={td}>{num(y.personal)} ({(y.business + y.personal ? 100 - pct(y.business, y.personal) : 0).toFixed(1)}%)</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-base font-black">2. Standard mileage deduction</h2>
        <p className="num rounded-lg border-2 border-ink p-3 text-center text-lg font-black">
          {num(y.business)} {unit} × {fmtRate(rate)}/{unit} = <span className="text-go-dark">{money(y.business * rate)}</span>
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-base font-black">3. Shift length breakdown</h2>
        <table className="num w-full border-collapse text-sm font-semibold">
          <tbody>
            <tr><th className={th}>Shifts logged</th><td className={td}>{y.shifts}</td><th className={th}>Total break time</th><td className={td}>{fmtDuration(y.breakMin)}</td></tr>
            <tr><th className={th}>Gross time on shift</th><td className={td}>{fmtDuration(y.lengthMin + y.breakMin)}</td><th className={th}>Net shift length</th><td className={td}>{fmtDuration(y.lengthMin)}</td></tr>
            <tr><th className={th}>Average shift length</th><td className={td}>{fmtDuration(y.shifts ? y.lengthMin / y.shifts : 0)}</td><th className={th}>Avg. business {unit} / shift</th><td className={td}>{num(y.shifts ? y.business / y.shifts : 0)}</td></tr>
          </tbody>
        </table>
        {y.byApp.size > 0 && (
          <table className="num mt-3 w-full border-collapse text-sm font-semibold">
            <thead>
              <tr><th className={th}>Platform</th><th className={th}>Shifts</th><th className={th}>Business {unit}*</th><th className={th}>Shift length*</th></tr>
            </thead>
            <tbody>
              {[...y.byApp.entries()].sort((a, b) => b[1].miles - a[1].miles).map(([name, r]) => (
                <tr key={name}><td className={td}>{name}</td><td className={td}>{r.shifts}</td><td className={td}>{num(r.miles)}</td><td className={td}>{fmtDuration(r.lengthMin)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {y.byApp.size > 0 && <p className="mt-1 text-[11px] font-semibold text-ink-2">* Shifts run on several platforms at once are split evenly between them.</p>}
      </section>

      <section>
        <h2 className="mb-2 text-base font-black">4. Monthly summary</h2>
        <div className="rounded-lg border border-slate-400">
          <MonthTable y={y} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-black">5. Contemporaneous mileage log</h2>
        <table className="num w-full border-collapse text-xs font-semibold">
          <thead>
            <tr>
              <th className={th}>Date</th><th className={th}>Purpose</th><th className={th}>Start odo</th><th className={th}>End odo</th><th className={th}>{unit}</th><th className={th}>Shift length</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) =>
              e.kind === 'shift' ? (
                <tr key={e.id} style={{ breakInside: 'avoid' }}>
                  <td className={td}>{fmtDateYear(e.shift.startTs)}</td>
                  <td className={td}>Business — {e.shift.platforms.join(', ') || 'gig work'}{e.shift.endTs === null ? ' (in progress)' : ''}</td>
                  <td className={td}>{num(e.shift.startOdo)}</td>
                  <td className={td}>{e.shift.endOdo === null ? '—' : num(e.shift.endOdo)}</td>
                  <td className={td}>{num(e.miles)}</td>
                  <td className={td}>{fmtDuration(shiftLengthMin(e.shift, now))}</td>
                </tr>
              ) : (
                <tr key={e.id} className="text-ink-2" style={{ breakInside: 'avoid' }}>
                  <td className={td}>{e.toTs ? fmtDateYear(e.toTs) : '—'}</td>
                  <td className={td}>Personal (not deductible)</td>
                  <td className={td}>{num(e.startOdo)}</td>
                  <td className={td}>{num(e.endOdo)}</td>
                  <td className={td}>{num(e.miles)}</td>
                  <td className={td}>—</td>
                </tr>
              ),
            )}
            {entries.length === 0 && (
              <tr><td className={td} colSpan={6}>No entries for this year.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="border-t-2 border-ink pt-2 text-[11px] font-semibold text-ink-2">
        Odometer readings are continuous: every {unit === 'mi' ? 'mile' : 'kilometre'} between the first and last reading is classified as business or personal. Shift dates use the shift's start time. This report
        is a record-keeping aid, not tax advice — confirm the applicable mileage rate and your eligibility with a tax professional.
      </p>
    </div>
  )
}

function TaxReport({ open, onClose, vehicle, ledger, now }: { open: boolean; onClose: () => void; vehicle: Vehicle; ledger: LedgerEntry[]; now: number }) {
  const years = useMemo(() => summarize(ledger, now), [ledger, now])
  const [year, setYear] = useState(years[0].year)
  const y = years.find((x) => x.year === year) ?? years[0]
  const body = <ReportBody vehicle={vehicle} y={y} ledger={ledger} now={now} />
  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        wide
        title="IRS Mileage Tax Report"
        footer={
          <div className="flex gap-2">
            <select className={cx(inputCls, 'w-auto')} value={y.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
              {years.map((x) => (
                <option key={x.year}>{x.year}</option>
              ))}
            </select>
            <Btn
              tone="amber"
              className="flex-1"
              onClick={() => {
                // Android WebView has no print dialog: share a standalone copy that any browser can print or save as PDF.
                if (!isNative) return window.print()
                const title = `Waypoint mileage report ${y.year} ${vehicle.model}`
                void saveFile(`${title.replace(/\W+/g, '-').toLowerCase()}.html`, standaloneHtml(title, document.getElementById('print-root')!), 'text/html')
              }}
            >
              <Printer size={20} strokeWidth={2.5} /> {isNative ? 'Share report' : 'Print / PDF'}
            </Btn>
          </div>
        }
      >
        {body}
      </Sheet>
      {open && createPortal(body, document.getElementById('print-root')!)}
    </>
  )
}
