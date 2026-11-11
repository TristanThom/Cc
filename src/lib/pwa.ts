import { useSyncExternalStore } from 'react'
import { isNative } from './native'
import { toast } from './store'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
let installed =
  isNative ||
  (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
type InstallState = 'installed' | 'ready' | 'manual'
const getState = (): InstallState => (installed ? 'installed' : deferred ? 'ready' : 'manual')

export function useInstall() {
  const state = useSyncExternalStore(subscribe, getState)
  const prompt = async () => {
    if (deferred) {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') deferred = null
      emit()
      return
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    toast(ios ? 'On iPhone: tap Share, then "Add to Home Screen".' : 'Open your browser menu and choose "Install app" or "Add to Home screen".')
  }
  return { state, prompt }
}

const subOnline = (f: () => void) => {
  window.addEventListener('online', f)
  window.addEventListener('offline', f)
  return () => {
    window.removeEventListener('online', f)
    window.removeEventListener('offline', f)
  }
}
export const useOnline = () => useSyncExternalStore(subOnline, () => navigator.onLine)
