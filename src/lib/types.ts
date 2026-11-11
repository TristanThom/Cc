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

export interface Settings {
  rate: number
  unit: Unit
  simBar: boolean
}

export interface AppData {
  vehicles: Vehicle[]
  activeVehicleId: string | null
  shifts: Shift[]
  platforms: Platform[]
  txns: Txn[]
  categories: Category[]
  maint: MaintItem[]
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
