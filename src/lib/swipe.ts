import { useEffect, type RefObject } from 'react'

/** Deliberately forgiving: a short, sloppy horizontal drag counts. */
export const SWIPE_MIN_PX = 48
/** Horizontal travel must beat vertical travel by this factor, so scrolling never changes tabs. */
export const SWIPE_RATIO = 1.3

/** +1 = next tab (finger moved left), -1 = previous tab, 0 = not a swipe. */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0
  return dx < 0 ? 1 : -1
}

const BLOCKED = '[role="dialog"], input, textarea, select, [data-noswipe]'

/** True if the touch began somewhere that owns horizontal gestures itself. */
function ownsHorizontalGesture(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(BLOCKED)) return true
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

/**
 * Calls `onSwipe` for a horizontal swipe that starts anywhere inside `ref`. Listeners are
 * passive and only decide on touch end, so vertical scrolling and taps are unaffected.
 */
export function useSwipeNav(ref: RefObject<HTMLElement | null>, enabled: boolean, onSwipe: (dir: -1 | 1) => void) {
  useEffect(() => {
    const root = ref.current
    if (!root || !enabled) return
    let start: { x: number; y: number } | null = null
    const onStart = (e: TouchEvent) => {
      start = e.touches.length === 1 && !ownsHorizontalGesture(e.target, root) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
    }
    const onEnd = (e: TouchEvent) => {
      const s = start
      start = null
      const t = e.changedTouches[0]
      if (!s || !t || e.touches.length > 0) return
      const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y)
      if (dir !== 0) onSwipe(dir)
    }
    const onCancel = () => {
      start = null
    }
    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchend', onEnd, { passive: true })
    root.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onCancel)
    }
  }, [ref, enabled, onSwipe])
}
