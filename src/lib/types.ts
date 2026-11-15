export type Unit = 'mi' | 'km'

export interface Vehicle {
  id: string
  year: string
  make: string
  model: string
  plate: string
  startOdo: number
  /** Latest manual odometer check made outside a shift. */
  odoReading?: number
}

export interface BreakEntry {
  id: string
  minutes: number
  ts: number
}

export interface Shift {
  id: string
  vehicleId: string
  startOdo: number
  endOdo: number | null
  startTs: number
  endTs: number | null
  platforms: string[] // platform names (snapshot, survives platform deletion)
  notes: string
  breakMin: number
  breaks: BreakEntry[]
  startPhoto?: string
  endPhoto?: string
}

export interface Platform {
  id: string
  name: string
  color: string
  active: boolean
  builtin?: boolean
}

export type TxnType = 'income' | 'expense'

export interface Txn {
  id: string
  vehicleId: string
  type: TxnType
  category: string
  amount: number
  ts: number
  note: string
  /** Set on entries created by a screenshot import, so importing the same period again updates them. */
  importKey?: string
}

/**
 * What a driver app reported for one of its own days or weeks, read from imported screenshots.
 * `date` is the app's calendar day (or the Monday of the week), as YYYY-MM-DD.
 */
export interface PlatformStat {
  id: string
  vehicleId: string
  app: string
  period: 'day' | 'week'
  date: string
  /** Total the app paid for the period, tips included. */
  earnings?: number
  tips?: number
  tipRides?: number
  onlineMin?: number
  bookedMin?: number
  bookedMi?: number
  trips?: number
  rejected?: number
  updatedAt: number
}

export interface Category {
  id: string
  type: TxnType
  name: string
  color: string
  hidden: boolean
  builtin?: boolean
}

export interface MaintItem {
  id: string
  vehicleId: string
  name: string
  interval: number
  notifyBefore: number
  lastServiceOdo: number
}

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  rate: number
  unit: Unit
  /** Missing in data saved before dark mode existed; treated as "system". */
  theme?: ThemeMode
  /** Screenshot imports add tips as their own entry, separate from the platform total. */
  splitTips?: boolean
  /** The import review points out what the screenshots did not include. Off once the driver hides it. */
  importHints?: boolean
}

export interface AppData {
  vehicles: Vehicle[]
  activeVehicleId: string | null
  shifts: Shift[]
  platforms: Platform[]
  txns: Txn[]
  categories: Category[]
  maint: MaintItem[]
  stats: PlatformStat[]
  settings: Settings
  onboarded: boolean
  isDemo: boolean
}

export type LedgerEntry =
  | { kind: 'shift'; id: string; shift: Shift; miles: number }
  | {
      kind: 'gap'
      id: string
      startOdo: number
      endOdo: number
      miles: number
      fromTs: number | null
      toTs: number | null
      note: string
    }
