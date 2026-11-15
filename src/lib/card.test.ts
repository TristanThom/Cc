import { describe, expect, it } from 'vitest'
import { cardMetrics, cardPeriod, previousPeriod, visibleMetrics, type CardInput } from './card'
import type { Offer } from './offers'
import type { PlatformStat, Shift, Txn } from './types'

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
const shift = (id: string, startTs: number, endTs: number, startOdo: number, endOdo: number): Shift => ({ id, vehicleId: 'v', startOdo, endOdo, startTs, endTs, platforms: [], notes: '', breakMin: 0, breaks: [] })
const income = (ts: number, amount: number, category = 'Uber'): Txn => ({ id: `${ts}${category}`, vehicleId: 'v', type: 'income', category, amount, ts, note: '' })
const offer = (t: number, outcome: 'accepted' | 'declined'): Offer => ({ id: String(t), app: 'lyft', t, resolvedAt: t, outcome, fare: 8, bonus: 0, hourly: 0, pickupMin: 3, pickupMi: 1, tripMin: 8, tripMi: 2, pickup: '', dropoff: '', rideType: '', riderRating: 5, queued: false, tags: [] })

const input: CardInput = {
  vehicle: { id: 'v', year: '', make: '', model: 'Prius', plate: '', startOdo: 1000 },
  shifts: [shift('a', at(2026, 11, 13, 14), at(2026, 11, 13, 22), 1000, 1100), shift('b', at(2026, 11, 14, 14), at(2026, 11, 15, 2), 1110, 1260)],
  txns: [income(at(2026, 11, 13, 20), 200), income(at(2026, 11, 14, 20), 360), income(at(2026, 11, 14, 21), 40, 'Tips / Cash')],
  stats: [{ id: 's', vehicleId: 'v', app: 'Lyft', period: 'day', date: '2026-11-14', earnings: 181.22, onlineMin: 253, trips: 21, updatedAt: 0 } as PlatformStat],
  offers: [offer(at(2026, 11, 14, 18), 'accepted'), offer(at(2026, 11, 14, 19), 'accepted'), offer(at(2026, 11, 14, 20), 'declined'), offer(at(2026, 11, 14, 21), 'accepted')],
  rate: 0.7,
  unit: 'mi',
  fuelSplit: 'ratio',
  now: at(2026, 11, 15, 12),
}

describe('share card', () => {
  it('treats a day as a working day from 4 AM, so a shift past midnight stays on one card', () => {
    const p = cardPeriod('day', at(2026, 11, 15, 1)) // 1 AM Sunday is still Saturday's working day
    expect([p.start, p.end]).toEqual([at(2026, 11, 14, 4), at(2026, 11, 15, 4)])
    expect(p.label).toBe('Sat, Nov 14')
    expect(previousPeriod('day', p).label).toBe('Fri, Nov 13')
    expect(cardPeriod('week', at(2026, 11, 14, 12)).label).toBe('Week of Nov 9')
  })

  it('builds the metrics for a day with change on the previous day', () => {
    const p = cardPeriod('day', at(2026, 11, 14, 18))
    const m = Object.fromEntries(cardMetrics(input, 'day', p).map((x) => [x.key, x]))
    expect(m.earnings.value).toBe('$400.00')
    expect(m.earnings.delta).toBeCloseTo(100, 6) // $200 the day before
    expect(m.shiftTime.value).toBe('12h 0m')
    expect(m.shiftHourly.value).toBe('$33.33/hr')
    expect(m.miles.value).toBe('150')
    expect(m.perMile.value).toBe('$2.67')
    expect(m.trips.value).toBe('21')
    expect(m.acceptance.value).toBe('75%')
    expect(m.lyftHourly.value).toBe('$42.98')
    expect(m.tips.value).toBe('$40.00')
    expect(m.uberHourly).toBeUndefined() // no Uber stats imported, so it is not offered
  })

  it('hides dollar totals but keeps rates and counts in hide-the-dollars mode', () => {
    const all = cardMetrics(input, 'day', cardPeriod('day', at(2026, 11, 14, 18)))
    const keys = ['earnings', 'shiftHourly', 'trips', 'tips', 'net']
    expect(visibleMetrics(all, keys, false).map((m) => m.key)).toEqual(['earnings', 'shiftHourly', 'trips', 'tips', 'net'])
    expect(visibleMetrics(all, keys, true).map((m) => m.key)).toEqual(['shiftHourly', 'trips'])
  })

  it('has nothing to show for a period with no data', () => {
    expect(cardMetrics(input, 'day', cardPeriod('day', at(2026, 10, 1, 12)))).toEqual([])
  })
})
