import { describe, expect, it } from 'vitest'
import { mergeGroups, parseDuration, parseEarnings, resolveDate, type OcrLine } from './earnings'

const line = (text: string, x: number, y: number, h = 36): OcrLine => ({ text, x, y, w: text.length * h * 0.55, h })
const portrait = (lines: OcrLine[]) => ({ width: 1248, height: 1972, lines })

/** Uber weekly earnings: headline total, day axis, stacked stats, labelled breakdown. */
const uber = (dx = 0): OcrLine[] => [
  line('$456.12', 380 + dx, 0, 70),
  line('$330.97', 16 + dx, 110, 34),
  ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => line(d, 90 + i * 124 + dx, 430)),
  line('Stats', 30 + dx, 535, 48),
  line('Online', 30 + dx, 645),
  line('Trips', 498 + dx, 645),
  line('11 h 6 m', 30 + dx, 695),
  line('53', 498 + dx, 695),
  line('Points', 30 + dx, 778),
  line('149', 30 + dx, 828),
  line('Breakdown', 30 + dx, 1005, 48),
  line('Net Fare', 60 + dx, 1108),
  line('$354.31', 60 + dx, 1160, 32),
  line('Promotions', 60 + dx, 1262),
  line('$17.81', 60 + dx, 1314, 32),
  line('Tip', 60 + dx, 1416),
  line('$84.00', 60 + dx, 1468, 32),
]

/** Lyft day screen: date, headline total, ride rows, stat tiles. */
const lyftDay = (dx = 0): OcrLine[] => [
  line('< Nov 13', 1060 + dx, 132),
  line('Nov 14', 1446 + dx, 132),
  line('$181.22', 1195 + dx, 255, 120),
  line('$6.37 Lyft', 1138 + dx, 472),
  line('incl. $1.72 bonus', 1138 + dx, 522),
  line('2:09 AM', 1802 + dx, 498),
  line('Your daily stats', 1036 + dx, 988, 44),
  line('EARNINGS', 1116 + dx, 1104),
  line('$42.31', 1065 + dx, 1228, 48),
  line('per booked hr', 1065 + dx, 1290),
  line('Rides', 1440 + dx, 1228),
  line('21', 1708 + dx, 1228),
  line('Rides rejected', 1440 + dx, 1290),
  line('13', 1708 + dx, 1290),
  line('TIP STATS', 1866 + dx, 1104),
  line('$14.79', 1815 + dx, 1184, 48),
  line('6 rides', 1815 + dx, 1245),
  line('$479.08 Balance', 1036 + dx, 1392),
]

/** Lyft "Driving stats" sheet over the day screen, whose total is half hidden. */
const lyftDriving: OcrLine[] = [
  line('$181.2Z', 250, 230, 90), // cut off by the header; must not become income
  line('$6.37 Lyft', 162, 450),
  line('Driving stats', 110, 632, 52),
  line('Nov 14', 38, 722),
  line('Rides completed', 128, 860, 42),
  line('21', 1112, 860, 42),
  line('Rides rejected', 128, 988, 42),
  line('Rides you missed, declined, or canceled', 128, 1046, 36),
  line('13', 1166, 1016, 42),
  line('Tips', 128, 1172, 42),
  line('6', 1186, 1172, 42),
  line('Booked time', 128, 1302, 42),
  line('Time spent driving to pick up and drop off', 128, 1360, 36),
  line('passengers', 128, 1415, 36),
  line('3 hr 56 min', 976, 1356, 42),
  line('Booked miles', 128, 1526, 42),
  line('Miles driven during booked time', 128, 1584, 36),
  line('49.17 mi', 1044, 1554, 42),
  line('Online time', 128, 1696, 42),
  line('Total time spent online in Lyft Driver app', 128, 1754, 36),
  line('4 hr 13 min', 984, 1724, 42),
]

const lyftTips: OcrLine[] = [
  line('Tip stats', 110, 196, 52),
  line('Nov 14', 38, 284),
  line('$14.79', 38, 375, 80),
  line('from 6 rides', 312, 410, 44),
  line('$5.00', 128, 612, 40),
  line('$11.96 Lyft', 128, 672),
  line('11:22 PM', 1004, 642),
  line('Ride on Nov 13, 8:48 PM', 128, 842),
]

const lyftEarnings: OcrLine[] = [
  line('$181.2Z', 250, 230, 90),
  line('Earnings stats', 110, 608, 52),
  line('Nov 14', 38, 698),
  line('$42.31', 38, 780, 80),
  line('/ booked hr', 322, 822, 44),
  line("Yesterday's per booked hr", 128, 1190, 42),
  line('$40.12', 1074, 1246, 42),
  line('Booked time', 128, 1416, 42),
  line('3 hr 56 min', 976, 1470, 42),
  line('Booked percentage', 128, 1640, 42),
  line('93%', 1118, 1696, 42),
]

describe('earnings screenshot parsing', () => {
  it('reads an Uber weekly screen: total, parts, online time and trips', () => {
    const [g] = parseEarnings({ width: 1000, height: 1510, lines: uber() })
    expect(g).toMatchObject({ platform: 'Uber', period: 'week', date: null, total: 456.12, netFare: 354.31, promotions: 17.81, tips: 84 })
    expect(g.stats).toEqual({ onlineMin: 666, trips: 53 })
  })

  it('uses the breakdown when the headline is cut off or misread', () => {
    const lines = uber().map((l) => (l.text === '$456.12' ? { ...l, text: '$456.1Z' } : l))
    expect(parseEarnings({ width: 1000, height: 1510, lines })[0].total).toBe(456.12)
  })

  it('reads a Lyft day: total, date, rides, tips; rates and ride rows are not income', () => {
    const [g] = parseEarnings({ width: 1000, height: 1510, lines: lyftDay(-1000) })
    expect(g).toMatchObject({ platform: 'Lyft', period: 'day', date: { month: 11, day: 14 }, total: 181.22, tips: 14.79 })
    expect(g.stats).toEqual({ trips: 21, rejected: 13, tipRides: 6 })
  })

  it('reads both apps from one side-by-side screenshot', () => {
    const groups = parseEarnings({ width: 2000, height: 1510, lines: [...uber(), ...lyftDay()] })
    expect(groups.map((g) => [g.platform, g.total])).toEqual([['Uber', 456.12], ['Lyft', 181.22]])
  })

  it('takes stats but never income from a Lyft drill-down sheet', () => {
    const [d] = parseEarnings(portrait(lyftDriving))
    expect(d).toMatchObject({ platform: 'Lyft', date: { month: 11, day: 14 }, total: null, tips: null })
    expect(d.stats).toEqual({ onlineMin: 253, bookedMin: 236, bookedMi: 49.17, trips: 21, rejected: 13, tipRides: 6 })

    const [t] = parseEarnings(portrait(lyftTips))
    expect(t).toMatchObject({ platform: 'Lyft', date: { month: 11, day: 14 }, total: null, tips: 14.79 })
    expect(t.stats).toEqual({ tipRides: 6 })

    const [e] = parseEarnings(portrait(lyftEarnings))
    expect(e).toMatchObject({ total: null, tips: null })
    expect(e.stats).toEqual({ bookedMin: 236 })
  })

  it('merges screenshots of the same app and day into one record', () => {
    const all = [lyftDay(-1000), lyftDriving, lyftTips, lyftEarnings].flatMap((lines) => parseEarnings(portrait(lines)))
    const { groups, conflicts } = mergeGroups(all)
    expect(conflicts).toEqual([])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ platform: 'Lyft', total: 181.22, tips: 14.79 })
    expect(groups[0].stats).toEqual({ trips: 21, rejected: 13, tipRides: 6, onlineMin: 253, bookedMin: 236, bookedMi: 49.17 })
  })

  it('reports two different totals for the same app and day', () => {
    const a = parseEarnings({ width: 1000, height: 1510, lines: lyftDay(-1000) })
    const b = parseEarnings({ width: 1000, height: 1510, lines: lyftDay(-1000).map((l) => (l.text === '$181.22' ? { ...l, text: '$187.22' } : l)) })
    expect(mergeGroups([...a, ...b]).conflicts).toHaveLength(1)
  })

  it('tells an Uber day from the week by which weekday label is highlighted', () => {
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const screen = (total: string, online: string, trips: string, highlight: string | null) => {
      const lines = [
        line('Nov 9 - Nov 16', 432, 160, 44),
        line(total, 480, 318, 80),
        line('$333.97', 18, 462, 40),
        line('Stats', 36, 985, 56),
        line('Online', 36, 1112),
        line('Trips', 624, 1112),
        line(online, 36, 1175),
        line(trips, 624, 1175),
        line('Net Fare', 74, 1680),
        // One recognised line can span the whole row, so the selection has to come from words.
        line('9 10 11 12 13 14 15', 140, 802, 40),
        line(DAYS.join(' '), 112, 852, 40),
      ]
      const words = DAYS.flatMap((d, i) => [
        { ...line(String(9 + i), 140 + i * 156, 802, 40), color: d === highlight ? '#6b8fe0' : '#b4b4b4' },
        { ...line(d, 112 + i * 156, 852, 40), color: d === highlight ? '#6b8fe0' : '#b4b4b4' },
      ])
      return parseEarnings({ width: 1248, height: 1972, lines, words })[0]
    }
    expect(screen('$459.12', '11 h 6 m', '53', null)).toMatchObject({ platform: 'Uber', period: 'week', date: { month: 11, day: 9 }, total: 459.12, stats: { onlineMin: 666, trips: 53 } })
    expect(screen('$125.15', '3 h 22 m', '16', 'Fri')).toMatchObject({ period: 'day', date: { month: 11, day: 13 }, total: 125.15, stats: { onlineMin: 202, trips: 16 } })
    expect(screen('$333.97', '7 h 43 m', '37', 'Sat')).toMatchObject({ period: 'day', date: { month: 11, day: 14 }, total: 333.97, stats: { onlineMin: 463, trips: 37 } })
  })

  it('returns nothing for an image with no amounts or stats', () => {
    expect(parseEarnings({ width: 1000, height: 1500, lines: [line('Hello', 10, 10), line('Settings', 10, 80)] })).toEqual([])
  })

  it('parses durations and resolves month/day to the most recent past date', () => {
    expect(parseDuration('3 hr 56 min')).toBe(236)
    expect(parseDuration('11 h 6 m')).toBe(666)
    expect(parseDuration('45 min')).toBe(45)
    expect(parseDuration('2 hr')).toBe(120)
    expect(parseDuration('21')).toBeNull()
    const now = new Date(2026, 10, 15, 9).getTime()
    expect(new Date(resolveDate({ month: 11, day: 14 }, now)).toDateString()).toBe(new Date(2026, 10, 14).toDateString())
    expect(new Date(resolveDate({ month: 12, day: 30 }, now)).getFullYear()).toBe(2025)
  })
})
