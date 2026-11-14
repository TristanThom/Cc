import { Radar, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fmtTime, relDate } from '../lib/engine'
import { OfferCapture, type CaptureStatus } from '../lib/offers'
import { toast } from '../lib/store'
import { Btn, Card, Confirm, cx } from './ui'

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/**
 * Android-only controls for offer tracking: the service that logs Lyft ride offers and
 * records Uber/Lyft driver-app screens to an on-device log used to improve the parsers.
 */
export default function OfferCaptureCard() {
  const [st, setSt] = useState<CaptureStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'capture' | 'offers' | null>(null)

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
        <Radar size={20} strokeWidth={2.5} /> Offer tracking <span className="rounded-full bg-amber px-2 text-brand py-0.5 text-[10px] uppercase tracking-wide">Beta</span>
      </h2>
      <p className="text-sm font-semibold text-ink-2">
        Logs each Lyft ride offer and whether you took it (see History → Offers). It also records what the Uber and Lyft driver apps show, with a screenshot when an offer appears, so Uber offers can be added.
        Other apps are ignored and nothing is sent anywhere. Uber and Lyft say tools like this break their terms; use it at your own risk.
      </p>

      <div className={cx('rounded-xl border-2 px-3 py-2 text-sm font-extrabold', recording ? 'border-go-dark bg-go-soft text-go-text' : 'border-ink bg-bg-2')} role="status">
        {recording ? 'Tracking — open your driver apps and drive as normal' : !st.serviceOn ? 'Step 1: allow Waypoint in Accessibility settings' : 'Ready — switch tracking on'}
      </div>

      {!st.serviceOn && (
        <>
          <Btn tone="amber" className="w-full" onClick={() => OfferCapture.openAccessibilitySettings()}>
            Open Accessibility settings
          </Btn>
          <p className="text-xs font-semibold text-ink-2">
            Find <b className="text-ink">Waypoint offer tracking</b> under Installed apps and turn it on. If Android says the setting is restricted, open App info, tap the ⋮ menu, choose{' '}
            <b className="text-ink">Allow restricted settings</b>, then try again.
          </p>
          <Btn className="w-full" onClick={() => OfferCapture.openAppInfo()}>
            Open App info
          </Btn>
        </>
      )}

      <label className="flex min-h-12 items-center justify-between gap-3 text-sm font-extrabold">
        Offer tracking on
        <input type="checkbox" className="size-7 accent-[#15803D]" checked={st.enabled} onChange={(e) => OfferCapture.setEnabled({ enabled: e.target.checked }).then(setSt)} />
      </label>

      <p className="num text-xs font-bold text-ink-2">
        {st.offers} offer{st.offers === 1 ? '' : 's'} logged · capture log {mb(st.logBytes)} · {st.shots} screenshot{st.shots === 1 ? '' : 's'}
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
      <div className="grid grid-cols-2 gap-2">
        <Btn tone="danger" disabled={st.logBytes === 0 && st.shots === 0} onClick={() => setConfirm('capture')}>
          <Trash2 size={18} strokeWidth={2.5} /> Clear capture
        </Btn>
        <Btn tone="danger" disabled={st.offers === 0} onClick={() => setConfirm('offers')}>
          <Trash2 size={18} strokeWidth={2.5} /> Clear offers
        </Btn>
      </div>
      <p className="text-xs font-semibold text-ink-2">
        The capture log contains rider first names and pickup addresses; only share it with someone you trust. Logged offers keep cross streets but no rider names. The newest 800 screenshots are kept.
      </p>

      <Confirm
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'offers' ? 'Delete offer history?' : 'Delete capture log?'}
        body={confirm === 'offers' ? 'This erases every logged ride offer from this phone. It cannot be undone.' : 'This erases the capture log and its screenshots from this phone. Your logged offers are kept.'}
        action="Delete"
        onConfirm={() => {
          if (confirm === 'offers') OfferCapture.clearOffers().then(refresh)
          else OfferCapture.clear().then(setSt)
        }}
      />
    </Card>
  )
}
