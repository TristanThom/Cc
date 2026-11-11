import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { defaultMaint, demoData, emptyData, uid } from './defaults'
import { activeShiftOf, adjustBreaks, chainFloor, currentOdo, defaultRate, KM_PER_MI, shiftBounds } from './engine'
import type { AppData, Category, MaintItem, Platform, Shift, Txn, TxnType, Unit, Vehicle } from './types'

/* ----------------------------- toasts ----------------------------- */

interface ToastState {
  toast: { id: number; msg: string; tone: 'ok' | 'err' } | null
  show: (msg: string, tone?: 'ok' | 'err') => void
}
export const useToast = create<ToastState>((set, get) => ({
  toast: null,
  show: (msg, tone = 'ok') => {
    const id = Date.now()
    set({ toast: { id, msg, tone } })
    setTimeout(() => get().toast?.id === id && set({ toast: null }), 3200)
  },
}))
export const toast = (msg: string, tone: 'ok' | 'err' = 'ok') => useToast.getState().show(msg, tone)

/* ----------------------------- storage ---------------------------- */

const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      toast('Storage is full — changes are not being saved. Remove proof photos or export a backup.', 'err')
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

/* ------------------------------ store ----------------------------- */

type Result = string | null // error message, or null on success

export interface Actions {
  // vehicles
  addVehicle: (v: Omit<Vehicle, 'id'>) => string
  updateVehicle: (id: string, patch: Omit<Vehicle, 'id' | 'odoReading'>) => Result
  deleteVehicle: (id: string) => void
  selectVehicle: (id: string) => void
  setOdoReading: (vehicleId: string, odo: number) => Result
  // shifts
  startShift: (vehicleId: string, odo: number, photo?: string) => Result
  endShift: (shiftId: string, endOdo: number, notes: string, photo?: string) => Result
  bumpBreak: (shiftId: string, delta: number) => void
  updateShift: (shiftId: string, patch: Partial<Omit<Shift, 'id' | 'vehicleId'>>) => Result
  deleteShift: (shiftId: string) => void
  // platforms
  togglePlatform: (id: string) => void
  setAllPlatforms: (active: boolean) => void
  addPlatform: (name: string, color: string) => Result
  removePlatform: (id: string) => void
  // money
  saveTxn: (t: Omit<Txn, 'id'> & { id?: string }) => void
  deleteTxn: (id: string) => void
  addCategory: (type: TxnType, name: string, color: string) => Result
  toggleCategory: (id: string) => void
  removeCategory: (id: string) => void
  // maintenance
  saveMaint: (m: Omit<MaintItem, 'id'> & { id?: string }) => void
  deleteMaint: (id: string) => void
  justChanged: (id: string) => void
  // settings & data
  setRate: (rate: number) => void
  setUnit: (unit: Unit) => void
  setSimBar: (on: boolean) => void
  finishOnboarding: () => void
  simulate: (mode: 'welcome' | 'empty' | 'demo') => void
  clearAll: () => void
  restore: (raw: unknown) => Result
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export const useStore = create<AppData & Actions>()(
  persist(
    (set, get) => ({
      ...emptyData(),

      addVehicle: (v) => {
        const id = uid()
        set((s) => ({
          vehicles: [...s.vehicles, { ...v, id }],
          activeVehicleId: id,
          maint: [...s.maint, ...defaultMaint(id, v.startOdo)],
          isDemo: false,
        }))
        return id
      },
      updateVehicle: (id, patch) => {
        const first = Math.min(...get().shifts.filter((s) => s.vehicleId === id).map((s) => s.startOdo))
        if (patch.startOdo > first) return `Starting odometer can't be above this vehicle's first shift (${first.toLocaleString()}).`
        set((s) => ({ vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }))
        return null
      },
      deleteVehicle: (id) =>
        set((s) => {
          const vehicles = s.vehicles.filter((v) => v.id !== id)
          return {
            vehicles,
            activeVehicleId: s.activeVehicleId === id ? (vehicles[0]?.id ?? null) : s.activeVehicleId,
            shifts: s.shifts.filter((x) => x.vehicleId !== id),
            txns: s.txns.filter((x) => x.vehicleId !== id),
            maint: s.maint.filter((x) => x.vehicleId !== id),
          }
        }),
      selectVehicle: (id) => set({ activeVehicleId: id }),
      setOdoReading: (vehicleId, odo) => {
        const { vehicles, shifts } = get()
        const v = vehicles.find((x) => x.id === vehicleId)
        if (!v) return 'Vehicle not found.'
        if (activeShiftOf(shifts, vehicleId)) return 'End the active shift to record a new reading.'
        const floor = chainFloor(v, shifts)
        if (odo < floor) return `Reading can't be below ${floor.toLocaleString()} — the last logged odometer.`
        set((s) => ({ vehicles: s.vehicles.map((x) => (x.id === vehicleId ? { ...x, odoReading: odo } : x)) }))
        return null
      },

      startShift: (vehicleId, odo, photo) => {
        const { vehicles, shifts, platforms } = get()
        const v = vehicles.find((x) => x.id === vehicleId)
        if (!v) return 'Add a vehicle first.'
        if (activeShiftOf(shifts, vehicleId)) return 'A shift is already active for this vehicle.'
        const floor = chainFloor(v, shifts)
        if (odo < floor) return `Start odometer can't be below ${floor.toLocaleString()} — the last logged reading.`
        const shift: Shift = {
          id: uid(),
          vehicleId,
          startOdo: odo,
          endOdo: null,
          startTs: Date.now(),
          endTs: null,
          platforms: platforms.filter((p) => p.active).map((p) => p.name),
          notes: '',
          breakMin: 0,
          breaks: [],
          startPhoto: photo,
        }
        set((s) => ({ shifts: [...s.shifts, shift], isDemo: false }))
        return null
      },
      endShift: (shiftId, endOdo, notes, photo) => {
        const sh = get().shifts.find((s) => s.id === shiftId)
        if (!sh) return 'Shift not found.'
        if (endOdo < sh.startOdo) return `End odometer can't be below the shift start (${sh.startOdo.toLocaleString()}).`
        const endTs = Date.now()
        set((s) => ({
          shifts: s.shifts.map((x) =>
            x.id === shiftId
              ? { ...x, endOdo, endTs, notes, endPhoto: photo ?? x.endPhoto, ...adjustBreaks({ ...x, endTs }, 0, endTs, uid) }
              : x,
          ),
        }))
        return null
      },
      bumpBreak: (shiftId, delta) =>
        set((s) => ({ shifts: s.shifts.map((x) => (x.id === shiftId ? { ...x, ...adjustBreaks(x, delta, Date.now(), uid) } : x)) })),
      updateShift: (shiftId, patch) => {
        const { shifts, vehicles } = get()
        const old = shifts.find((s) => s.id === shiftId)
        const v = vehicles.find((x) => x.id === old?.vehicleId)
        if (!old || !v) return 'Shift not found.'
        const next = { ...old, ...patch }
        const { min, max } = shiftBounds(v, shifts, shiftId)
        if (next.startOdo < min) return `Start odometer can't be below ${min.toLocaleString()} (previous entry in the chain).`
        if (next.endOdo !== null) {
          if (next.endOdo < next.startOdo) return 'End odometer must be at or above the start odometer.'
          if (next.endOdo > max) return `End odometer can't be above ${max.toLocaleString()} (next shift's start).`
        } else if (next.startOdo > max) return `Start odometer can't be above ${max.toLocaleString()}.`
        if (next.endTs !== null && next.endTs < next.startTs) return 'End time must be after the start time.'
        const now = Date.now()
        if (next.startTs > now || (next.endTs ?? 0) > now) return "Shift times can't be in the future."
        const fixed = { ...next, ...adjustBreaks(next, 0, now, uid) }
        set((s) => ({ shifts: s.shifts.map((x) => (x.id === shiftId ? fixed : x)) }))
        return null
      },
      deleteShift: (shiftId) => set((s) => ({ shifts: s.shifts.filter((x) => x.id !== shiftId) })),

      togglePlatform: (id) => set((s) => ({ platforms: s.platforms.map((p) => (p.id === id ? { ...p, active: !p.active } : p)) })),
      setAllPlatforms: (active) => set((s) => ({ platforms: s.platforms.map((p) => ({ ...p, active })) })),
      addPlatform: (name, color) => {
        name = name.trim()
        if (!name) return 'Enter a platform name.'
        if (get().platforms.some((p) => sameName(p.name, name))) return 'That platform already exists.'
        const p: Platform = { id: uid(), name, color, active: true }
        set((s) => ({ platforms: [...s.platforms, p] }))
        return null
      },
      removePlatform: (id) => set((s) => ({ platforms: s.platforms.filter((p) => p.id !== id) })),

      saveTxn: (t) =>
        set((s) => ({
          isDemo: false,
          txns: t.id ? s.txns.map((x) => (x.id === t.id ? { ...t, id: x.id } : x)) : [...s.txns, { ...t, id: uid() }],
        })),
      deleteTxn: (id) => set((s) => ({ txns: s.txns.filter((x) => x.id !== id) })),
      addCategory: (type, name, color) => {
        name = name.trim()
        if (!name) return 'Enter a name.'
        if (get().categories.some((c) => c.type === type && sameName(c.name, name))) return 'That option already exists.'
        const c: Category = { id: uid(), type, name, color, hidden: false }
        set((s) => ({ categories: [...s.categories, c] }))
        return null
      },
      toggleCategory: (id) => set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c)) })),
      removeCategory: (id) => set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),

      saveMaint: (m) =>
        set((s) => ({
          maint: m.id ? s.maint.map((x) => (x.id === m.id ? { ...m, id: x.id } : x)) : [...s.maint, { ...m, id: uid() }],
        })),
      deleteMaint: (id) => set((s) => ({ maint: s.maint.filter((x) => x.id !== id) })),
      justChanged: (id) =>
        set((s) => {
          const item = s.maint.find((x) => x.id === id)
          const v = s.vehicles.find((x) => x.id === item?.vehicleId)
          if (!item || !v) return {}
          const odo = currentOdo(v, s.shifts)
          return { maint: s.maint.map((x) => (x.id === id ? { ...x, lastServiceOdo: odo } : x)) }
        }),

      setRate: (rate) => set((s) => ({ settings: { ...s.settings, rate } })),
      setUnit: (unit) =>
        set((s) => {
          if (unit === s.settings.unit) return {}
          // Odometer readings stay as entered; only the per-distance rate is converted.
          const r = s.settings.rate
          const converted = r === defaultRate(s.settings.unit) ? defaultRate(unit) : unit === 'km' ? r / KM_PER_MI : r * KM_PER_MI
          return { settings: { ...s.settings, unit, rate: Math.round(converted * 1000) / 1000 } }
        }),
      setSimBar: (on) => set((s) => ({ settings: { ...s.settings, simBar: on } })),
      finishOnboarding: () => set({ onboarded: true }),

      simulate: (mode) => {
        const keep = get().settings
        if (mode === 'demo') return set({ ...demoData(), settings: keep })
        const data = emptyData()
        if (mode === 'welcome') return set({ ...data, settings: keep })
        const id = uid()
        set({
          ...data,
          settings: keep,
          onboarded: true,
          vehicles: [{ id, year: '2021', make: 'Toyota', model: 'Prius Prime', plate: '', startOdo: 48210 }],
          activeVehicleId: id,
          maint: defaultMaint(id, 48210),
          isDemo: true,
        })
      },
      clearAll: () => set({ ...emptyData(), settings: get().settings }),
      restore: (raw) => {
        const d = (raw as { data?: Partial<AppData> })?.data ?? (raw as Partial<AppData>)
        if (!d || typeof d !== 'object' || !Array.isArray(d.vehicles) || !Array.isArray(d.shifts)) {
          return 'That file is not a Waypoint backup.'
        }
        const base = emptyData()
        const arr = <T,>(x: T[] | undefined, fallback: T[]) => (Array.isArray(x) ? x : fallback)
        const vehicles = d.vehicles.filter((v) => v && typeof v.id === 'string' && Number.isFinite(v.startOdo))
        const ids = new Set(vehicles.map((v) => v.id))
        set({
          vehicles,
          activeVehicleId: ids.has(d.activeVehicleId ?? '') ? d.activeVehicleId! : (vehicles[0]?.id ?? null),
          shifts: d.shifts.filter((s) => s && ids.has(s.vehicleId) && Number.isFinite(s.startOdo) && Number.isFinite(s.startTs)),
          txns: arr(d.txns, []).filter((t) => t && ids.has(t.vehicleId) && Number.isFinite(t.amount)),
          maint: arr(d.maint, []).filter((m) => m && ids.has(m.vehicleId)),
          platforms: arr(d.platforms, base.platforms),
          categories: arr(d.categories, base.categories),
          settings: { ...base.settings, ...(d.settings ?? {}) },
          onboarded: vehicles.length > 0,
          isDemo: false,
        })
        return null
      },
    }),
    {
      name: 'waypoint-v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
    },
  ),
)

/** Plain serialisable snapshot of the persisted data (no actions). */
export function snapshot(): AppData {
  const s = useStore.getState()
  const { vehicles, activeVehicleId, shifts, platforms, txns, categories, maint, settings, onboarded, isDemo } = s
  return { vehicles, activeVehicleId, shifts, platforms, txns, categories, maint, settings, onboarded, isDemo }
}

export const useVehicle = (): Vehicle | undefined =>
  useStore((s) => s.vehicles.find((v) => v.id === s.activeVehicleId) ?? s.vehicles[0])

/** Re-renders every `ms` with the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
