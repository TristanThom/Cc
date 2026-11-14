import type { LedgerEntry, MaintItem, Shift, Txn, Unit, Vehicle } from './types'

/* ------------------------------------------------------------------ */
/* Time: gig payout weeks start Monday 4:00 AM Eastern                 */
/* ------------------------------------------------------------------ */

export const PAYOUT_TZ = 'America/New_York'
const HOUR = 3_600_000
const DAY = 24 * HOUR

const etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PAYOUT_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** Eastern wall-clock time of `ts`, encoded as if it were UTC ms. */
export function etWall(ts: number): number {
  const p: Record<string, number> = {}
  for (const part of etFmt.formatToParts(ts)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/** Inverse of etWall: Eastern wall-clock (encoded as UTC ms) → real instant. */
export function fromEtWall(wall: number): number {
  let guess = wall - (etWall(wall) - wall)
  guess = wall - (etWall(guess) - guess)
  return guess
}

/** Start of the payout week containing `ts`: Monday 04:00 Eastern. */
export function weekStart(ts: number): number {
  const d = new Date(etWall(ts) - 4 * HOUR)
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  return fromEtWall(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow, 4))
}

export function weekEnd(start: number): number {
  return fromEtWall(etWall(start) + 7 * DAY)
}

export function monthStart(ts: number): number {
  const d = new Date(etWall(ts))
  return fromEtWall(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function monthEnd(start: number): number {
  const d = new Date(etWall(start))
  return fromEtWall(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

export type PeriodMode = 'week' | 'month'
export interface Period {
  mode: PeriodMode | 'year' | 'all'
  start: number
  end: number
  label: string
}

const etDay = new Intl.DateTimeFormat('en-US', { timeZone: PAYOUT_TZ, month: 'short', day: 'numeric' })
const etYear = new Intl.DateTimeFormat('en-US', { timeZone: PAYOUT_TZ, year: 'numeric' })
const etMonth = new Intl.DateTimeFormat('en-US', { timeZone: PAYOUT_TZ, month: 'long', year: 'numeric' })

export function periodFor(mode: PeriodMode, ts: number): Period {
  if (mode === 'week') {
    const start = weekStart(ts)
    const end = weekEnd(start)
    return { mode, start, end, label: `${etDay.format(start)} – ${etDay.format(end)}, ${etYear.format(end)}` }
  }
  const start = monthStart(ts)
  return { mode, start, end: monthEnd(start), label: etMonth.format(start) }
}

/** The calendar year (Eastern time) containing `ts`: what matters for taxes. */
export function yearPeriod(ts: number): Period {
  const y = new Date(etWall(ts)).getUTCFullYear()
  return { mode: 'year', start: fromEtWall(Date.UTC(y, 0, 1)), end: fromEtWall(Date.UTC(y + 1, 0, 1)), label: String(y) }
}

/** Short label for a payout week, e.g. "Week of Nov 9". */
export const weekLabel = (p: Period) => `Week of ${etDay.format(p.start)}`

export const ALL_TIME: Period = { mode: 'all', start: -Infinity, end: Infinity, label: 'All time' }

export const inPeriod = (ts: number, p: Period) => ts >= p.start && ts < p.end

/** Most-recent-first list of periods from now back to `earliest` (min `minCount`). */
export function listPeriods(mode: PeriodMode, now: number, earliest: number, minCount = 8): Period[] {
  const out: Period[] = []
  let p = periodFor(mode, now)
  while (out.length < 520 && (out.length < minCount || p.end > earliest)) {
    out.push(p)
    p = periodFor(mode, p.start - 1)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Shift length                                                        */
/* ------------------------------------------------------------------ */

export function grossMinutes(s: Shift, now: number): number {
  return Math.max(0, Math.floor(((s.endTs ?? now) - s.startTs) / 60_000))
}

/** Shift Length = gross elapsed time − total break time. */
export function shiftLengthMin(s: Shift, now: number): number {
  return Math.max(0, grossMinutes(s, now) - s.breakMin)
}

export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Apply a ±delta to a shift's breaks, clamped to [0, gross elapsed]. */
export function adjustBreaks(s: Shift, delta: number, now: number, newId: () => string): Pick<Shift, 'breakMin' | 'breaks'> {
  const target = Math.min(Math.max(0, s.breakMin + delta), grossMinutes(s, now))
  let diff = target - s.breakMin
  const breaks = s.breaks.map((b) => ({ ...b }))
  if (diff > 0) breaks.push({ id: newId(), minutes: diff, ts: now })
  while (diff < 0 && breaks.length) {
    const last = breaks[breaks.length - 1]
    const take = Math.min(last.minutes, -diff)
    last.minutes -= take
    diff += take
    if (last.minutes <= 0) breaks.pop()
  }
  return { breakMin: target, breaks }
}

/* ------------------------------------------------------------------ */
/* Continuous odometer chain                                           */
/* ------------------------------------------------------------------ */

export function vehicleShifts(shifts: Shift[], vehicleId: string): Shift[] {
  return shifts
    .filter((s) => s.vehicleId === vehicleId)
    .sort((a, b) => a.startOdo - b.startOdo || a.startTs - b.startTs)
}

export const activeShiftOf = (shifts: Shift[], vehicleId: string) =>
  shifts.find((s) => s.vehicleId === vehicleId && s.endTs === null)

/** Highest odometer the chain has already accounted for (no new reading may go below it). */
export function chainFloor(v: Vehicle, shifts: Shift[]): number {
  let floor = v.startOdo
  for (const s of shifts) if (s.vehicleId === v.id) floor = Math.max(floor, s.endOdo ?? s.startOdo)
  return floor
}

export function currentOdo(v: Vehicle, shifts: Shift[]): number {
  return Math.max(chainFloor(v, shifts), v.odoReading ?? 0)
}

/**
 * Builds the unbroken ledger for one vehicle, oldest first. Every mile between
 * the vehicle's starting odometer and its current reading lands in exactly one
 * entry: a business shift, or an auto-calculated personal gap.
 */
export function buildLedger(v: Vehicle, allShifts: Shift[]): LedgerEntry[] {
  const out: LedgerEntry[] = []
  let prevEnd = v.startOdo
  let prevTs: number | null = null
  let open = false
  for (const s of vehicleShifts(allShifts, v.id)) {
    if (s.startOdo > prevEnd) {
      out.push({
        kind: 'gap',
        id: `gap-${s.id}`,
        startOdo: prevEnd,
        endOdo: s.startOdo,
        miles: s.startOdo - prevEnd,
        fromTs: prevTs,
        toTs: s.startTs,
        note: prevTs === null ? 'Personal driving before first shift' : 'Personal driving between shifts',
      })
    }
    const end = s.endOdo ?? s.startOdo
    out.push({ kind: 'shift', id: s.id, shift: s, miles: Math.max(0, end - s.startOdo) })
    prevEnd = Math.max(prevEnd, end)
    prevTs = s.endTs ?? s.startTs
    if (s.endTs === null) open = true
  }
  const cur = currentOdo(v, allShifts)
  if (!open && cur > prevEnd) {
    out.push({
      kind: 'gap',
      id: 'gap-open',
      startOdo: prevEnd,
      endOdo: cur,
      miles: cur - prevEnd,
      fromTs: prevTs,
      toTs: null,
      note: 'Personal driving since last shift (open)',
    })
  }
  return out
}

/** Allowed odometer window for a shift so it can never overlap its neighbours. */
export function shiftBounds(v: Vehicle, allShifts: Shift[], shiftId: string): { min: number; max: number } {
  const list = vehicleShifts(allShifts, v.id)
  const i = list.findIndex((s) => s.id === shiftId)
  const prev = list[i - 1]
  const next = list[i + 1]
  return {
    min: prev ? (prev.endOdo ?? prev.startOdo) : v.startOdo,
    max: next ? next.startOdo : Infinity,
  }
}

export interface MileTotals {
  business: number
  personal: number
  total: number
  businessPct: number
  shiftCount: number
  lengthMin: number
  breakMin: number
}

/** Mileage totals for a period. Shifts are bucketed by start time, gaps by the shift that closed them. */
export function mileTotals(ledger: LedgerEntry[], p: Period, now: number): MileTotals {
  let business = 0
  let personal = 0
  let shiftCount = 0
  let lengthMin = 0
  let breakMin = 0
  for (const e of ledger) {
    if (e.kind === 'shift') {
      if (!inPeriod(e.shift.startTs, p)) continue
      business += e.miles
      shiftCount++
      lengthMin += shiftLengthMin(e.shift, now)
      breakMin += e.shift.breakMin
    } else if (inPeriod(e.toTs ?? now, p)) {
      personal += e.miles
    }
  }
  const total = business + personal
  return { business, personal, total, businessPct: total ? (business / total) * 100 : 0, shiftCount, lengthMin, breakMin }
}

export function moneyTotals(txns: Txn[], vehicleId: string, p: Period) {
  let income = 0
  let expense = 0
  for (const t of txns) {
    if (t.vehicleId !== vehicleId || !inPeriod(t.ts, p)) continue
    if (t.type === 'income') income += t.amount
    else expense += t.amount
  }
  return { income, expense, net: income - expense }
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

export type MaintStatus = 'ok' | 'soon' | 'overdue'

export function maintState(item: MaintItem, odo: number) {
  const used = Math.max(0, odo - item.lastServiceOdo)
  const remaining = item.interval - used
  const status: MaintStatus = remaining <= 0 ? 'overdue' : remaining <= item.notifyBefore ? 'soon' : 'ok'
  return { used, remaining, status, pct: Math.min(100, (used / Math.max(1, item.interval)) * 100), dueAt: item.lastServiceOdo + item.interval }
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const money = (n: number) => usd.format(n)
export const signedMoney = (n: number) => (n < 0 ? '-' : '+') + usd.format(Math.abs(n))
export const num = (n: number) => Math.round(n).toLocaleString('en-US')
/** Per-distance rate with at least two decimals: $0.70, $0.435. */
export const fmtRate = (r: number) => '$' + (Math.round(r * 1000) % 10 ? r.toFixed(3) : r.toFixed(2))
export const KM_PER_MI = 1.609344
export const defaultRate = (unit: Unit) => (unit === 'mi' ? 0.7 : 0.435)

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const dateYearFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
export const fmtDate = (ts: number) => dateFmt.format(ts)
export const fmtDateYear = (ts: number) => dateYearFmt.format(ts)
export const fmtTime = (ts: number) => timeFmt.format(ts)

export function relDate(ts: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const diff = Math.round((day(now) - day(ts)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  return new Date(ts).getFullYear() === new Date(now).getFullYear() ? fmtDate(ts) : fmtDateYear(ts)
}

/** Value for <input type="datetime-local"> in device-local time. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

const csvCell = (v: string | number) => {
  const s = String(v)
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function ledgerCsv(v: Vehicle, ledger: LedgerEntry[], rate: number, unit: Unit, now: number): string {
  const rows: (string | number)[][] = [
    ['Vehicle', 'Type', 'Date', 'Start Time', 'End Time', `Start Odometer (${unit})`, `End Odometer (${unit})`, `Distance (${unit})`, 'Platforms', 'Shift Length', 'Shift Length (min)', 'Break (min)', `Rate ($/${unit})`, 'Deduction ($)', 'Notes'],
  ]
  const name = [v.year, v.make, v.model].filter(Boolean).join(' ')
  const iso = (ts: number | null) => (ts === null ? '' : new Date(ts).toLocaleDateString('en-CA'))
  for (const e of ledger) {
    if (e.kind === 'shift') {
      const s = e.shift
      const len = shiftLengthMin(s, now)
      rows.push([name, s.endTs === null ? 'Business (in progress)' : 'Business', iso(s.startTs), fmtTime(s.startTs), s.endTs ? fmtTime(s.endTs) : '', s.startOdo, s.endOdo ?? '', e.miles, s.platforms.join('; '), fmtDuration(len), len, s.breakMin, rate, (e.miles * rate).toFixed(2), s.notes])
    } else {
      rows.push([name, 'Personal', iso(e.toTs ?? e.fromTs), '', '', e.startOdo, e.endOdo, e.miles, '', '', '', '', '', '0.00', e.note])
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
