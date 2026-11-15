import { inPeriod, weekEnd, weekStart, type Period } from './engine'
import type { PlatformStat, Shift, Txn } from './types'

/**
 * Each driver app closes its day at a different hour (device-local time): an Uber day runs
 * 4:00 AM to 3:59 AM, a Lyft day 5:00 AM to 4:59 AM. Other apps fall back to 4 AM.
 */
export const DAY_START_HOUR: Record<string, number> = { Uber: 4, Lyft: 5 }
export const dayStartHour = (app: string) => DAY_START_HOUR[app] ?? 4

const HOUR = 3_600_000
const pad = (n: number) => String(n).padStart(2, '0')
export const toDateKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const fromDateKey = (key: string, hour: number) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, hour).getTime()
}

/** The stat's date key for an app day that contains `ts` (before the app's day start = previous day). */
export const appDayKey = (app: string, ts: number) => toDateKey(ts - dayStartHour(app) * HOUR)
/** The date key a weekly stat is stored under: the Monday its pay week starts. */
export const weekKey = (ts: number) => toDateKey(weekStart(ts))

/** The span of real time a stat covers. */
export function statWindow(s: Pick<PlatformStat, 'app' | 'period' | 'date'>): [number, number] {
  if (s.period === 'week') {
    const start = weekStart(fromDateKey(s.date, 12))
    return [start, weekEnd(start)]
  }
  const start = fromDateKey(s.date, dayStartHour(s.app))
  const [y, m, d] = s.date.split('-').map(Number)
  return [start, new Date(y, m - 1, d + 1, dayStartHour(s.app)).getTime()]
}

/**
 * Net shift minutes (elapsed minus breaks) that fall inside [start, end). A shift that
 * straddles the boundary is split; its break time is shared out in proportion.
 */
export function shiftMinutesIn(shifts: Shift[], vehicleId: string, start: number, end: number, now: number): number {
  let total = 0
  for (const s of shifts) {
    if (s.vehicleId !== vehicleId) continue
    const sEnd = s.endTs ?? now
    const gross = sEnd - s.startTs
    if (gross <= 0) continue
    const overlap = Math.min(sEnd, end) - Math.max(s.startTs, start)
    if (overlap <= 0) continue
    const net = Math.max(0, gross - s.breakMin * 60_000)
    total += (net * (overlap / gross)) / 60_000
  }
  return total
}

export interface AppHours {
  app: string
  /** Number of stat records behind these totals, and whether any is a whole-week record. */
  records: number
  earnings: number | null
  tips: number | null
  onlineMin: number | null
  bookedMin: number | null
  bookedMi: number | null
  trips: number | null
  rejected: number | null
  /** Shift time inside the spans this app's stats cover. */
  shiftMin: number
  /** Earnings per hour the app had you online. */
  onlineHourly: number | null
}

export interface HoursSummary {
  shiftMin: number
  income: number
  /** All income in the period per shift hour: the accurate hourly figure. */
  shiftHourly: number | null
  apps: AppHours[]
  /** Uber online + Lyft online. Can exceed shift time, because an hour on both apps counts twice. */
  totalOnlineMin: number | null
}

const add = (a: number | null, b: number | undefined) => (b === undefined ? a : (a ?? 0) + b)

/** Stats whose span starts inside the period. When a week has daily stats for an app, its weekly stat is skipped. */
export function statsInPeriod(stats: PlatformStat[], vehicleId: string, p: Period): PlatformStat[] {
  const mine = stats.filter((s) => s.vehicleId === vehicleId)
  const days = mine.filter((s) => s.period === 'day')
  return mine.filter((s) => {
    const [start, end] = statWindow(s)
    // A stat belongs to the period that holds the middle of its span.
    if (!inPeriod(start + (end - start) / 2, p)) return false
    if (s.period === 'week') return !days.some((d) => d.app === s.app && statWindow(d)[0] >= start && statWindow(d)[0] < end)
    return true
  })
}

export function hoursSummary(stats: PlatformStat[], shifts: Shift[], txns: Txn[], vehicleId: string, p: Period, now: number): HoursSummary {
  const shiftMin = shiftMinutesIn(shifts, vehicleId, p.start, Math.min(p.end, now), now)
  const income = txns.filter((t) => t.vehicleId === vehicleId && t.type === 'income' && inPeriod(t.ts, p)).reduce((a, t) => a + t.amount, 0)

  const byApp = new Map<string, AppHours>()
  for (const s of statsInPeriod(stats, vehicleId, p)) {
    const a = byApp.get(s.app) ?? { app: s.app, records: 0, earnings: null, tips: null, onlineMin: null, bookedMin: null, bookedMi: null, trips: null, rejected: null, shiftMin: 0, onlineHourly: null }
    a.records++
    a.earnings = add(a.earnings, s.earnings)
    a.tips = add(a.tips, s.tips)
    a.onlineMin = add(a.onlineMin, s.onlineMin)
    a.bookedMin = add(a.bookedMin, s.bookedMin)
    a.bookedMi = add(a.bookedMi, s.bookedMi)
    a.trips = add(a.trips, s.trips)
    a.rejected = add(a.rejected, s.rejected)
    const [start, end] = statWindow(s)
    a.shiftMin += shiftMinutesIn(shifts, vehicleId, start, Math.min(end, now), now)
    byApp.set(s.app, a)
  }
  const apps = [...byApp.values()].sort((x, y) => x.app.localeCompare(y.app))
  for (const a of apps) a.onlineHourly = a.earnings !== null && a.onlineMin ? a.earnings / (a.onlineMin / 60) : null
  const online = apps.filter((a) => a.onlineMin !== null)

  return {
    shiftMin,
    income,
    shiftHourly: shiftMin >= 1 && income > 0 ? income / (shiftMin / 60) : null,
    apps,
    totalOnlineMin: online.length ? online.reduce((sum, a) => sum + (a.onlineMin ?? 0), 0) : null,
  }
}
