import { registerPlugin } from '@capacitor/core'
import { Radar, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { relDate, fmtTime } from '../lib/engine'
import { toast } from '../lib/store'
import { Btn, Card, Confirm, cx } from './ui'

interface CaptureStatus {
  enabled: boolean
  serviceOn: boolean
  logBytes: number
  lastEventAt: number
  shots: number
}

interface OfferCapturePlugin {
  status(): Promise<CaptureStatus>
  setEnabled(o: { enabled: boolean }): Promise<CaptureStatus>
  openAccessibilitySettings(): Promise<void>
  openAppInfo(): Promise<void>
  exportZip(o: { shots: boolean }): Promise<{ uri: string; bytes: number }>
  clear(): Promise<CaptureStatus>
}

const OfferCapture = registerPlugin<OfferCapturePlugin>('OfferCapture')
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/**
 * Android-only controls for capture mode: records Uber/Lyft driver-app screens to an
 * on-device log so the accepted/rejected offer logger can be built from real data.
 */
export default function OfferCaptureCard() {
  const [st, setSt] = useState<CaptureStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const refresh = useCallback(() => {
    OfferCapture.status().then(setSt).catch(() => setSt(null))
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refresh])

  if (!st) return null
  const recording = st.enabled && st.serviceOn

  const share = async (shots: boolean) => {
    setBusy(true)
    try {
      const { uri } = await OfferCapture.exportZip({ shots })
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: 'Waypoint offer capture', files: [uri] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (/nothing captured|export failed/i.test(msg)) toast(msg, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-base font-black">
        <Radar size={20} strokeWidth={2.5} /> Offer capture <span className="rounded-full bg-amber px-2 py-0.5 text-[10px] uppercase tracking-wide">Beta</span>
      </h2>
      <p className="text-sm font-semibold text-ink-2">
        Records what the Uber and Lyft driver apps show (text, your taps, and periodic screenshots) to a log on this phone, so accepted and rejected offers can be logged. Other apps are ignored and nothing is
        sent anywhere. Uber and Lyft say tools like this break their terms; use it at your own risk.
      </p>

      <div className={cx('rounded-xl border-2 px-3 py-2 text-sm font-extrabold', recording ? 'border-go-dark bg-emerald-50 text-go-dark' : 'border-ink bg-bg-2')} role="status">
        {recording ? 'Recording — open your driver app and drive as normal' : !st.serviceOn ? 'Step 1: allow Waypoint in Accessibility settings' : 'Ready — switch capture on to record'}
      </div>

      {!st.serviceOn && (
        <>
          <Btn tone="amber" className="w-full" onClick={() => OfferCapture.openAccessibilitySettings()}>
            Open Accessibility settings
          </Btn>
          <p className="text-xs font-semibold text-ink-2">
            Find <b className="text-ink">Waypoint offer capture</b> under Installed apps and turn it on. If Android says the setting is restricted, open App info, tap the ⋮ menu, choose{' '}
            <b className="text-ink">Allow restricted settings</b>, then try again.
          </p>
          <Btn className="w-full" onClick={() => OfferCapture.openAppInfo()}>
            Open App info
          </Btn>
        </>
      )}

      <label className="flex min-h-12 items-center justify-between gap-3 text-sm font-extrabold">
        Capture on
        <input type="checkbox" className="size-7 accent-[#15803D]" checked={st.enabled} onChange={(e) => OfferCapture.setEnabled({ enabled: e.target.checked }).then(setSt)} />
      </label>

      <p className="num text-xs font-bold text-ink-2">
        Log {mb(st.logBytes)} · {st.shots} screenshot{st.shots === 1 ? '' : 's'}
        {st.lastEventAt > 0 && ` · last entry ${relDate(st.lastEventAt, Date.now())} ${fmtTime(st.lastEventAt)}`}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Btn tone="ink" disabled={busy || st.logBytes === 0} onClick={() => share(false)}>
          <Share2 size={18} strokeWidth={2.5} /> Share log
        </Btn>
        <Btn disabled={busy || st.logBytes === 0} onClick={() => share(true)}>
          <Share2 size={18} strokeWidth={2.5} /> + screenshots
        </Btn>
      </div>
      <Btn tone="danger" className="w-full" disabled={st.logBytes === 0 && st.shots === 0} onClick={() => setConfirmClear(true)}>
        <Trash2 size={18} strokeWidth={2.5} /> Delete captured data
      </Btn>
      <p className="text-xs font-semibold text-ink-2">The log contains rider first names and pickup addresses. Only share it with someone you trust.</p>

      <Confirm
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Delete captured data?"
        body="This erases the capture log and all captured screenshots from this phone."
        action="Delete"
        onConfirm={() => OfferCapture.clear().then(setSt)}
      />
    </Card>
  )
}
