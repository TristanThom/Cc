import { registerPlugin } from '@capacitor/core'
import { isNative } from './native'

export type OfferOutcome = 'accepted' | 'declined' | 'missed'

/** One ride offer logged by the Android offer-tracking service. Distances are miles, as shown by the driver app. */
export interface Offer {
  id: string
  app: 'lyft' | 'uber'
  t: number
  resolvedAt: number
  outcome: OfferOutcome
  fare: number
  bonus: number
  hourly: number
  pickupMin: number
  pickupMi: number
  tripMin: number
  tripMi: number
  pickup: string
  dropoff: string
  rideType: string
  riderRating: number
  queued: boolean
  tags: string[]
}

export interface CaptureStatus {
  enabled: boolean
  serviceOn: boolean
  logBytes: number
  lastEventAt: number
  shots: number
  offers: number
}

interface OfferCapturePlugin {
  status(): Promise<CaptureStatus>
  setEnabled(o: { enabled: boolean }): Promise<CaptureStatus>
  openAccessibilitySettings(): Promise<void>
  openAppInfo(): Promise<void>
  exportZip(o: { shots: boolean }): Promise<{ uri: string; bytes: number }>
  clear(): Promise<CaptureStatus>
  offers(): Promise<{ offers: Offer[] }>
  clearOffers(): Promise<void>
}

export const OfferCapture = registerPlugin<OfferCapturePlugin>('OfferCapture')

/** Offers newest first. In a browser there is no tracking service, so this is empty. */
export async function loadOffers(): Promise<Offer[]> {
  if (!isNative) {
    // Lets the browser test suite exercise the Offers screen.
    const test = (window as { __WAYPOINT_TEST_OFFERS?: Offer[] }).__WAYPOINT_TEST_OFFERS
    return test ? [...test].sort((a, b) => b.t - a.t) : []
  }
  const { offers } = await OfferCapture.offers()
  return offers.filter((o) => o && Number.isFinite(o.t) && Number.isFinite(o.fare)).sort((a, b) => b.t - a.t)
}

export const offerMiles = (o: Offer) => o.pickupMi + o.tripMi
export const offerMinutes = (o: Offer) => o.pickupMin + o.tripMin
/** Fare per total mile driven for the offer (pickup + trip), or null when distance is unknown. */
export const perMile = (o: Offer) => (offerMiles(o) > 0 ? o.fare / offerMiles(o) : null)

export interface OfferStats {
  total: number
  accepted: number
  declined: number
  missed: number
  /** accepted / (accepted + declined + missed), 0..100 */
  acceptRate: number
}

export function offerStats(offers: Offer[]): OfferStats {
  const s = { total: offers.length, accepted: 0, declined: 0, missed: 0, acceptRate: 0 }
  for (const o of offers) {
    if (o.outcome === 'accepted') s.accepted++
    else if (o.outcome === 'declined') s.declined++
    else s.missed++
  }
  s.acceptRate = s.total ? (s.accepted / s.total) * 100 : 0
  return s
}
