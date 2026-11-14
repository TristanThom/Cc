import { useEffect } from 'react'
import { useStore } from './store'
import type { ThemeMode } from './types'

/** Which palette to show for a setting, given the phone's own light/dark preference. */
export function resolveTheme(mode: ThemeMode | undefined, systemDark: boolean): 'light' | 'dark' {
  if (mode === 'dark' || mode === 'light') return mode
  return systemDark ? 'dark' : 'light'
}

/**
 * Applies the chosen theme to <html data-theme>. With "system" it follows the phone and
 * switches live when the phone does. index.html sets the same attribute before first paint.
 */
export function useTheme() {
  const mode = useStore((s) => s.settings.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(mode, mq.matches)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [mode])
}
