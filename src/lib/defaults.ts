import type { AppData, Category, MaintItem, Platform, Shift, Txn, Vehicle } from './types'

export const uid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

export const SWATCHES = ['#0F172A', '#DC2626', '#EA580C', '#F59E0B', '#15803D', '#0D9488', '#0284C7', '#2563EB', '#7C3AED', '#DB2777']

const BRAND: [string, string][] = [
  ['Uber', '#000000'],
  ['Lyft', '#FF00BF'],
  ['DoorDash', '#FF3008'],
  ['Instacart', '#0AAD0A'],
  ['Amazon Flex', '#FF9900'],
  ['Spark', '#0053E2'],
  ['Uber Eats', '#06C167'],
  ['Grubhub', '#F63440'],
]

export const defaultPlatforms = (): Platform[] =>
  BRAND.map(([name, color], i) => ({ id: uid(), name, color, active: i < 2, builtin: true }))

export const defaultCategories = (): Category[] => {
  const mk = (type: Category['type'], name: string, color: string): Category => ({ id: uid(), type, name, color, hidden: false, builtin: true })
  return [
    mk('income', 'Uber', '#000000'),
    mk('income', 'Lyft', '#FF00BF'),
    mk('income', 'DoorDash', '#FF3008'),
    mk('income', 'Instacart', '#0AAD0A'),
    mk('income', 'Tips / Cash', '#15803D'),
    mk('income', 'Bonus / Quest', '#7C3AED'),
    mk('expense', 'Fuel / Gas', '#B91C1C'),
    mk('expense', 'Maintenance', '#334155'),
    mk('expense', 'Tolls / Parking', '#0284C7'),
    mk('expense', 'Car Wash', '#0D9488'),
    mk('expense', 'Tires / Brakes', '#EA580C'),
  ]
}

export const MAINT_PRESETS: { name: string; interval: number; notifyBefore: number }[] = [
  { name: 'Oil Change', interval: 5000, notifyBefore: 500 },
  { name: 'Tires', interval: 40000, notifyBefore: 2000 },
  { name: 'Brakes', interval: 30000, notifyBefore: 2000 },
  { name: 'Transmission', interval: 60000, notifyBefore: 3000 },
  { name: 'Air Filter', interval: 15000, notifyBefore: 1000 },
]

export const defaultMaint = (vehicleId: string, odo: number): MaintItem[] =>
  MAINT_PRESETS.map((p) => ({ id: uid(), vehicleId, ...p, lastServiceOdo: odo }))

export const emptyData = (): AppData => ({
  vehicles: [],
  activeVehicleId: null,
  shifts: [],
  platforms: defaultPlatforms(),
  txns: [],
  categories: defaultCategories(),
  maint: [],
  settings: { rate: 0.7, unit: 'mi', theme: 'system' },
  onboarded: false,
  isDemo: false,
})

/* ------------------------------------------------------------------ */
/* Demo data — deterministic, anchored to "now"                        */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function demoData(now = Date.now()): AppData {
  const DAY = 86_400_000
  const base = emptyData()
  const prius: Vehicle = { id: uid(), year: '2021', make: 'Toyota', model: 'Prius Prime', plate: 'GIG-4821', startOdo: 48210 }
  const crv: Vehicle = { id: uid(), year: '2019', make: 'Honda', model: 'CR-V', plate: 'DLV-7730', startOdo: 81540 }
  const shifts: Shift[] = []
  const txns: Txn[] = []
  const NOTES = ['Airport runs, steady surge', 'Lunch rush downtown', 'Slow start, strong dinner peak', 'Stadium event — long pickups', 'Rainy day, high demand', '', '', '']

  const build = (v: Vehicle, seed: number, days: number, every: number, combos: string[][], perMile: number) => {
    const r = rng(seed)
    let odo = v.startOdo
    const today = new Date(now)
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    for (let d = days; d >= 1; d--) {
      if (r() > every) continue
      odo += 4 + Math.floor(r() * 22) // personal gap before the shift
      const startTs = midnight - d * DAY + (7 + Math.floor(r() * 8)) * 3_600_000 + Math.floor(r() * 4) * 900_000
      const gross = 240 + Math.floor(r() * 22) * 15
      const breakMin = [0, 15, 30, 30, 45][Math.floor(r() * 5)]
      const miles = Math.round(((gross - breakMin) / 60) * (14 + r() * 9))
      const platforms = combos[Math.floor(r() * combos.length)]
      const endTs = startTs + gross * 60_000
      const breaks = breakMin ? Array.from({ length: breakMin / 15 }, (_, i) => ({ id: uid(), minutes: 15, ts: startTs + (i + 2) * 3_600_000 })) : []
      shifts.push({ id: uid(), vehicleId: v.id, startOdo: odo, endOdo: odo + miles, startTs, endTs, platforms, notes: NOTES[Math.floor(r() * NOTES.length)], breakMin, breaks })
      odo += miles
      const gross$ = miles * perMile * (0.85 + r() * 0.4)
      platforms.forEach((p, i) => {
        const share = platforms.length === 1 ? 1 : i === 0 ? 0.6 : 0.4 / (platforms.length - 1)
        txns.push({ id: uid(), vehicleId: v.id, type: 'income', category: p, amount: Math.round(gross$ * share * 100) / 100, ts: endTs + i * 60_000, note: '' })
      })
      if (r() < 0.45) txns.push({ id: uid(), vehicleId: v.id, type: 'income', category: 'Tips / Cash', amount: 5 + Math.floor(r() * 30), ts: endTs + 300_000, note: 'Cash tips' })
      if (r() < 0.12) txns.push({ id: uid(), vehicleId: v.id, type: 'income', category: 'Bonus / Quest', amount: 25 + Math.floor(r() * 4) * 15, ts: endTs + 600_000, note: 'Weekly quest completed' })
      if (r() < 0.4) txns.push({ id: uid(), vehicleId: v.id, type: 'expense', category: 'Fuel / Gas', amount: Math.round((18 + r() * 30) * 100) / 100, ts: startTs - 900_000, note: 'Fill-up' })
      if (r() < 0.12) txns.push({ id: uid(), vehicleId: v.id, type: 'expense', category: 'Tolls / Parking', amount: Math.round((3 + r() * 12) * 100) / 100, ts: startTs + 3_600_000, note: 'Airport toll' })
      if (r() < 0.07) txns.push({ id: uid(), vehicleId: v.id, type: 'expense', category: 'Car Wash', amount: 15, ts: endTs + 1_800_000, note: '' })
    }
    return odo
  }

  const priusOdo = build(prius, 7, 44, 0.8, [['Uber'], ['Uber', 'Lyft'], ['Lyft'], ['Uber', 'DoorDash'], ['Uber', 'Lyft']], 1.35)
  const crvOdo = build(crv, 21, 30, 0.4, [['DoorDash'], ['Instacart'], ['DoorDash', 'Instacart'], ['Amazon Flex'], ['Spark']], 1.15)
  prius.odoReading = priusOdo + 9 // open personal gap since the last shift
  txns.push({ id: uid(), vehicleId: prius.id, type: 'expense', category: 'Maintenance', amount: 89.99, ts: now - 12 * DAY, note: 'Synthetic oil change' })

  const mk = (vehicleId: string, name: string, interval: number, notifyBefore: number, usedNow: number, cur: number): MaintItem => ({
    id: uid(), vehicleId, name, interval, notifyBefore, lastServiceOdo: cur - usedNow,
  })
  const maint: MaintItem[] = [
    mk(prius.id, 'Oil Change', 5000, 500, 1840, priusOdo),
    mk(prius.id, 'Tires', 40000, 2000, 38650, priusOdo),
    mk(prius.id, 'Brakes', 30000, 2000, 30420, priusOdo),
    mk(prius.id, 'Transmission', 60000, 3000, 21300, priusOdo),
    mk(prius.id, 'Air Filter', 15000, 1000, 6100, priusOdo),
    mk(crv.id, 'Oil Change', 5000, 500, 4720, crvOdo),
    mk(crv.id, 'Tires', 40000, 2000, 12200, crvOdo),
    mk(crv.id, 'Brakes', 30000, 2000, 9800, crvOdo),
    mk(crv.id, 'Transmission', 60000, 3000, 41000, crvOdo),
    mk(crv.id, 'Air Filter', 15000, 1000, 15600, crvOdo),
  ]

  return {
    ...base,
    vehicles: [prius, crv],
    activeVehicleId: prius.id,
    shifts,
    txns,
    maint,
    platforms: base.platforms.map((p) => ({ ...p, active: ['Uber', 'Lyft'].includes(p.name) })),
    onboarded: true,
    isDemo: true,
  }
}
