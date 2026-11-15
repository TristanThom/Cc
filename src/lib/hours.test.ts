import { describe, expect, it } from 'vitest'
import { periodFor } from './engine'
import { appDayKey, hoursSummary, shiftMinutesIn, statWindow, statsInPeriod } from './hours'
import type { PlatformStat, Shift, Txn } from './types'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const shift = (id: string, startTs: number, endTs: number | null, breakMin = 0): Shift => ({ id, vehicleId: 'v', startOdo: 0, endOdo: endTs === null ? null : 10, startTs, endTs, platforms: [], notes: '', breakMin, breaks: [] })
const stat = (app: string, period: 'day' | 'week', date: string, extra: Partial<PlatformStat> = {}): PlatformStat => ({ id: app + date + period, vehicleId: 'v', app, period, date, updatedAt: 0, ...extra })
const income = (ts: number, amount: number): Txn => ({ id: String(ts), vehicleId: 'v', type: 'income', category: 'Uber', amount, ts, note: '' })

describe('app day boundaries', () => {
  it('an Uber day runs 4:00 AM to 3:59 AM and a Lyft day 5:00 AM to 4:59 AM', () => {
    expect(statWindow(stat('Uber', 'day', '2026-11-14'))).toEqual([at(2026, 11, 14, 4), at(2026, 11, 15, 4)])
    expect(statWindow(stat('Lyft', 'day', '2026-11-14'))).toEqual([at(2026, 11, 14, 5), at(2026, 11, 15, 5)])
  })
  it('files a late-night ride under the previous app day', () => {
    expect(appDayKey('Lyft', at(2026, 11, 15, 2, 9))).toBe('2026-11-14')
    // 4:30 AM is already the next Uber day but still the previous Lyft day.
    expect(appDayKey('Uber', at(2026, 11, 15, 4, 30))).toBe('2026-11-15')
    expect(appDayKey('Lyft', at(2026, 11, 15, 4, 30))).toBe('2026-11-14')
    expect(appDayKey('Lyft', at(2026, 11, 15, 5))).toBe('2026-11-15')
  })
})

describe('shift time inside a span', () => {
  const now = at(2026, 11, 16, 12)
  it('splits a shift across the boundary and shares out its break', () => {
    // 2 PM to 6 AM = 16h with a 60 min break -> 15h net.
    const s = [shift('a', at(2026, 11, 14, 14), at(2026, 11, 15, 6), 60)]
    const uberDay = shiftMinutesIn(s, 'v', at(2026, 11, 14, 4), at(2026, 11, 15, 4), now)
    const nextDay = shiftMinutesIn(s, 'v', at(2026, 11, 15, 4), at(2026, 11, 16, 4), now)
    expect(uberDay).toBeCloseTo(14 * 60 * (15 / 16), 6)
    expect(uberDay + nextDay).toBeCloseTo(15 * 60, 6)
    // The Lyft day keeps one more hour of the same shift.
    expect(shiftMinutesIn(s, 'v', at(2026, 11, 14, 5), at(2026, 11, 15, 5), now)).toBeCloseTo(15 * 60 * (15 / 16), 6)
  })
  it('counts an open shift up to now and ignores other vehicles', () => {
    expect(shiftMinutesIn([shift('a', now - 90 * 60_000, null)], 'v', 0, now + 1e9, now)).toBeCloseTo(90, 6)
    expect(shiftMinutesIn([{ ...shift('a', 0, 60_000 * 60), vehicleId: 'other' }], 'v', 0, 1e12, now)).toBe(0)
  })
})

describe('shift time versus online time', () => {
  const now = at(2026, 11, 16, 12)
  const week = periodFor('week', at(2026, 11, 14, 18))
  const shifts = [shift('a', at(2026, 11, 14, 14), at(2026, 11, 15, 3), 60)] // 12h net
  const stats = [
    stat('Lyft', 'day', '2026-11-14', { earnings: 181.22, tips: 14.79, onlineMin: 253, bookedMin: 236, bookedMi: 49.17, trips: 21, rejected: 13 }),
    stat('Uber', 'day', '2026-11-14', { earnings: 330.97, onlineMin: 600, trips: 34 }),
  ]
  const txns = [income(at(2026, 11, 14, 20), 181.22), income(at(2026, 11, 14, 21), 330.97)]

  it('gives one accurate shift hourly, a per-app online hourly, and total online time', () => {
    const h = hoursSummary(stats, shifts, txns, 'v', week, now)
    expect(h.shiftMin).toBeCloseTo(720, 6)
    expect(h.shiftHourly).toBeCloseTo(512.19 / 12, 6)
    const lyft = h.apps.find((a) => a.app === 'Lyft')!
    const uber = h.apps.find((a) => a.app === 'Uber')!
    expect(lyft.onlineHourly).toBeCloseTo(181.22 / (253 / 60), 6)
    expect(uber.onlineHourly).toBeCloseTo(330.97 / 10, 6)
    expect(lyft.shiftMin).toBeCloseTo(720, 6)
    // Added together, online time can exceed the shift: both apps were on at once.
    expect(h.totalOnlineMin).toBe(853)
    expect(h.totalOnlineMin!).toBeGreaterThan(h.shiftMin)
  })

  it('prefers daily stats over a weekly stat for the same app and week', () => {
    const weekly = stat('Uber', 'week', '2026-11-09', { earnings: 456.12, onlineMin: 666, trips: 53 })
    expect(statsInPeriod([...stats, weekly], 'v', week).map((s) => s.id).sort()).toEqual(stats.map((s) => s.id).sort())
    // With no daily Uber stats, the weekly one is used.
    const h = hoursSummary([stats[0], weekly], shifts, txns, 'v', week, now)
    expect(h.apps.find((a) => a.app === 'Uber')).toMatchObject({ earnings: 456.12, onlineMin: 666, trips: 53 })
  })

  it('has no hourly figures without shift time or stats', () => {
    const h = hoursSummary([], [], [], 'v', week, now)
    expect(h).toMatchObject({ shiftMin: 0, shiftHourly: null, apps: [], totalOnlineMin: null })
  })
})
