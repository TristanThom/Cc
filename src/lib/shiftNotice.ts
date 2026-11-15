import { registerPlugin } from '@capacitor/core'
import { useEffect } from 'react'
import { fmtTime } from './engine'
import { isNative } from './native'
import { useStore } from './store'
import type { Shift } from './types'

interface ShiftNotifierPlugin {
  show(o: { startTs: number; breakMin: number; title: string; text: string }): Promise<{ shown: boolean }>
  clear(): Promise<void>
}

const ShiftNotifier = registerPlugin<ShiftNotifierPlugin>('ShiftNotifier')

/** What the notification should say for a shift, or null when no shift is running. */
export function shiftNotice(shifts: Shift[], vehicleModel: (id: string) => string | undefined) {
  // With shifts open on several vehicles, show the one started most recently.
  const active = shifts.filter((s) => s.endTs === null).sort((a, b) => b.startTs - a.startTs)[0]
  if (!active) return null
  const parts = [`Since ${fmtTime(active.startTs)}`, active.breakMin > 0 ? `${active.breakMin}m break` : '', active.platforms.join(', ')].filter(Boolean)
  const model = vehicleModel(active.vehicleId)
  return { startTs: active.startTs, breakMin: active.breakMin, title: model ? `Shift active · ${model}` : 'Shift active', text: parts.join(' · ') }
}

/**
 * Keeps an ongoing notification with a live shift-length timer while a shift is active
 * (Android app only), and removes it when the shift ends.
 */
export function useShiftNotification() {
  const shifts = useStore((s) => s.shifts)
  const vehicles = useStore((s) => s.vehicles)
  const notice = shiftNotice(shifts, (id) => vehicles.find((v) => v.id === id)?.model)
  const key = notice ? JSON.stringify(notice) : ''
  useEffect(() => {
    if (!isNative) return
    if (key) ShiftNotifier.show(JSON.parse(key)).catch(() => {})
    else ShiftNotifier.clear().catch(() => {})
  }, [key])
}
