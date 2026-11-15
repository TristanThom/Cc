import { buildLedger, fmtDuration, inPeriod, mileTotals, money, num, periodFor, weekLabel, type Period } from './engine'
import { hoursSummary } from './hours'
import type { Offer } from './offers'
import { fuelSummary } from './receipt'
import type { FuelSplit, PlatformStat, Shift, Txn, Unit, Vehicle } from './types'

export type CardSpan = 'day' | 'week' | 'month'

const HOUR = 3_600_000
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** The period a card covers. A day is a working day: 4:00 AM to 3:59 AM, device-local time. */
export function cardPeriod(span: CardSpan, ts: number): Period {
  if (span === 'week') {
    const p = periodFor('week', ts)
    return { ...p, label: weekLabel(p) }
  }
  if (span === 'month') return periodFor('month', ts)
  const d = new Date(ts - 4 * HOUR)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4).getTime()
  return { mode: 'all', start, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 4).getTime(), label: dayFmt.format(start) }
}

export const previousPeriod = (span: CardSpan, p: Period): Period => cardPeriod(span, p.start - 12 * HOUR)

export interface CardInput {
  vehicle: Vehicle
  shifts: Shift[]
  txns: Txn[]
  stats: PlatformStat[]
  offers: Offer[]
  rate: number
  unit: Unit
  fuelSplit: FuelSplit
  now: number
}

export interface CardMetric {
  key: string
  label: string
  value: string
  /** A dollar total, left off the card in hide-the-dollars mode. Rates and counts are not. */
  isTotal: boolean
  /** Change against the previous period in percent, when both periods have a figure. */
  delta: number | null
}

type Numbers = Record<string, number | null>

function numbers(i: CardInput, p: Period): Numbers {
  const v = i.vehicle.id
  const ledger = buildLedger(i.vehicle, i.shifts)
  const miles = mileTotals(ledger, p, i.now)
  const h = hoursSummary(i.stats, i.shifts, i.txns, v, p, i.now)
  const mine = i.txns.filter((t) => t.vehicleId === v && inPeriod(t.ts, p))
  const income = mine.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0)
  const expenseRaw = mine.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0)
  const fuel = fuelSummary(i.txns, v, p, miles.business, miles.personal, i.fuelSplit)
  const statTips = h.apps.some((a) => a.tips !== null) ? h.apps.reduce((a, x) => a + (x.tips ?? 0), 0) : null
  const tipEntries = mine.filter((t) => t.type === 'income' && /tip/i.test(t.category)).reduce((a, t) => a + t.amount, 0)
  const offers = i.offers.filter((o) => inPeriod(o.t, p))
  const app = (name: string) => h.apps.find((a) => a.app === name)?.onlineHourly ?? null
  const has = (n: number) => (n > 0 ? n : null)
  return {
    earnings: has(income),
    net: income > 0 || expenseRaw > 0 ? income - (expenseRaw - fuel.total + fuel.business) : null,
    tips: statTips ?? has(tipEntries),
    trips: h.apps.some((a) => a.trips !== null) ? h.apps.reduce((a, x) => a + (x.trips ?? 0), 0) : null,
    shiftTime: has(h.shiftMin),
    onlineTime: h.totalOnlineMin,
    shiftHourly: h.shiftHourly,
    miles: has(miles.business),
    perMile: income > 0 && miles.business > 0 ? income / miles.business : null,
    acceptance: offers.length ? (offers.filter((o) => o.outcome === 'accepted').length / offers.length) * 100 : null,
    offers: has(offers.length),
    writeOff: has(miles.business * i.rate),
    uberHourly: app('Uber'),
    lyftHourly: app('Lyft'),
  }
}

const SPEC: { key: string; label: (u: Unit) => string; fmt: (n: number, u: Unit) => string; isTotal?: boolean }[] = [
  { key: 'earnings', label: () => 'Earnings', fmt: (n) => money(n), isTotal: true },
  { key: 'shiftHourly', label: () => 'Per shift hour', fmt: (n) => `${money(n)}/hr` },
  { key: 'shiftTime', label: () => 'Shift time', fmt: (n) => fmtDuration(n) },
  { key: 'trips', label: () => 'Trips', fmt: (n) => num(n) },
  { key: 'miles', label: (u) => `Business ${u}`, fmt: (n) => num(n) },
  { key: 'perMile', label: (u) => `Per ${u}`, fmt: (n) => money(n) },
  { key: 'tips', label: () => 'Tips', fmt: (n) => money(n), isTotal: true },
  { key: 'onlineTime', label: () => 'Online time', fmt: (n) => fmtDuration(n) },
  { key: 'uberHourly', label: () => 'Uber / online hr', fmt: (n) => money(n) },
  { key: 'lyftHourly', label: () => 'Lyft / online hr', fmt: (n) => money(n) },
  { key: 'acceptance', label: () => 'Acceptance rate', fmt: (n) => `${Math.round(n)}%` },
  { key: 'offers', label: () => 'Offers seen', fmt: (n) => num(n) },
  { key: 'net', label: () => 'Net profit', fmt: (n) => money(n), isTotal: true },
  { key: 'writeOff', label: () => 'Tax write-off', fmt: (n) => money(n), isTotal: true },
]

/** Every metric that has data for the period, in display order, with its change on the previous period. */
export function cardMetrics(i: CardInput, span: CardSpan, p: Period): CardMetric[] {
  const cur = numbers(i, p)
  const prev = numbers(i, previousPeriod(span, p))
  return SPEC.filter((s) => cur[s.key] !== null).map((s) => {
    const c = cur[s.key] as number
    const before = prev[s.key]
    return { key: s.key, label: s.label(i.unit), value: s.fmt(c, i.unit), isTotal: !!s.isTotal, delta: before !== null && before > 0 ? ((c - before) / before) * 100 : null }
  })
}

export const ALL_CARD_KEYS = SPEC.map((s) => s.key)
/** What a new card shows before the driver chooses. */
export const DEFAULT_CARD_KEYS = ['earnings', 'shiftHourly', 'shiftTime', 'trips', 'miles', 'perMile']

/** The metrics to draw: chosen ones that have data, minus dollar totals when those are hidden. */
export function visibleMetrics(all: CardMetric[], chosen: string[], hideDollars: boolean): CardMetric[] {
  return all.filter((m) => chosen.includes(m.key) && !(hideDollars && m.isTotal))
}
