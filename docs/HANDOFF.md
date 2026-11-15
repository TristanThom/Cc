# Waypoint: handoff notes

Read this first when picking the project up in a new session. It records what exists, the
decisions already made with the owner, what has and has not been verified, and what is next.
`README.md` covers how to run and build.

## What Waypoint is

An Android-first app (also runs as a web app) for rideshare drivers: continuous odometer and
IRS mileage, shifts, income and expenses, maintenance alerts, ride-offer logging for Uber and
Lyft, and comparisons of shift time against the apps' own online time. All data stays on the
phone. Formerly named ShiftOdo; the Android app id is `com.waypoint.app`.

- Web app: Vite + React + TypeScript + Tailwind v4, state in one persisted zustand store.
- Android: Capacitor shell in `android/`, with native Java in
  `android/app/src/main/java/com/waypoint/app/`.
- Branch: `ccr-39fdc34e-qhsqy8`. No pull request has been opened.

## How the owner gets a build

Every push runs `.github/workflows/android.yml`, which runs the web and Java unit tests and
builds a debug APK. The owner downloads `Waypoint-debug-apk` from the run's Artifacts and
installs `app-debug.apk` over the existing app (builds share a fixed test key in
`android/app/debug.keystore`, so data is kept). The Android SDK cannot be downloaded in the
cloud session, so CI is the only compile check for native code.

Publishing the APK as a GitHub release was tried and removed: the repo does not allow the
workflow write access, and the run failed to start.

## Working agreements with the owner

- They often say "this is just a question, don't change anything". Treat that as standing
  until they say to build.
- Recommend first, then build; flag complications before starting.
- Nothing native has been run on a device by the developer. Say so in every summary and tell
  the owner what to check on their phone.
- They drive with a Samsung Fold unfolded, Uber on the left and Lyft on the right.
- Privacy promises made in the app's own text must stay true (see Offer tracking below).

## Features and where they live

| Area | Files |
|---|---|
| Odometer chain, periods, CSV | `src/lib/engine.ts` |
| Store, settings, import upsert | `src/lib/store.ts`, `src/lib/types.ts` |
| Tabs | `src/tabs/Home.tsx`, `Income.tsx`, `History.tsx`, `Offers.tsx`, `Alerts.tsx`, `Settings.tsx` |
| Earnings screenshot reading | `src/lib/earnings.ts`, `src/components/EarningsImport.tsx` |
| Receipts, fuel split | `src/lib/receipt.ts`, `src/components/ReceiptImport.tsx`, `FuelCard.tsx` |
| Shift vs online time | `src/lib/hours.ts`, `src/components/HoursCard.tsx` |
| Share card | `src/lib/card.ts`, `src/components/ShareCard.tsx` |
| Page swipe, dark mode, shift notification | `src/lib/swipe.ts`, `theme.ts`, `shiftNotice.ts` |
| Offer tracking service | `OfferCaptureService.java`, `LyftOfferTracker.java`, `UberOfferParser.java`, `UberOfferTracker.java` |
| Native bridge | `OfferCapturePlugin.java` (offers, capture log, text recognition, kept pictures), `ShiftNotifierPlugin.java` |

## Decisions already made

- Pay weeks start Monday 4:00 AM US Eastern (follows daylight saving). Home shows
  "Week of Nov 9".
- "Personal gaps" are called "Personal".
- A timed-out offer counts as declined. There is no separate "missed".
- App days: Uber 4:00 AM to 3:59 AM, Lyft 5:00 AM to 4:59 AM, device-local time. A shift
  crossing a boundary is split, with break time shared in proportion.
- Shift hourly (all income over Waypoint shift time) is the accurate hourly figure. Each app
  also gets its own online hourly. Online times are added together for comparison with shift
  time, but there is no combined online hourly.
- Screenshot import makes one income entry per app and period, tips included. "Count tips
  separately" is a remembered preference. Importing a period again replaces it (`importKey`).
- If a week has both weekly and daily stats for an app, the daily ones are used.
- Lyft's drill-down sheets (Driving, Tip, Earnings stats) supply stats only, never the income
  total, because the day's total is half hidden behind the sheet.
- Uber's earnings screen is a day when one weekday label is highlighted and a week when none
  is. The highlight is detected from the sampled colour of each word.
- Fuel counts toward expenses by a driver-chosen rule: by miles (default), all business, or
  not counted.
- Share cards never show addresses, rider details or the plate. A card day is a working day
  from 4 AM.

## Offer tracking (accessibility service)

- Lyft offers are read from the app's text. Verified against two real overnight logs: the
  parser's results matched a replay of the raw capture exactly, and Lyft's own count of
  rejected rides for that day.
- Uber hides its offer card from accessibility. The service screenshots Uber's own window when
  its screen collapses to eight or fewer elements, reads the text with on-device ML Kit, and
  parses the card. Accepted means a new pickup appeared afterwards; otherwise declined after
  30 seconds. This path is unit-tested but has not been confirmed on a device.
- Privacy rules enforced in code: only full-size application windows of the two driver apps
  are read; screenshots are cropped to those windows; nothing is captured while another app
  covers them. An earlier build photographed YouTube; that path was removed.
- Uber and Lyft say tools like this break their terms. The owner knows and chose to proceed.
- No auto-accept or auto-decline, by design.

## Verified and not verified

Verified here: all web unit tests (`npm test`), Java unit tests for the Lyft and Uber offer
code, and browser tests of the main flows using injected text-recognition results.

Not verified on a device: Uber offer reading, colour detection for Uber's highlighted day,
receipt reading, the shift notification, keeping and exporting imported pictures, and sharing
the card image.

## Getting logs from the owner

Settings > Offer tracking > Share log gives a zip (`events.jsonl`, `offers.jsonl`); the
"+ screenshots" version adds images. Settings > Screenshot import > Export check gives kept
imports with what was read. The Drive connector refuses files over 10 MB, and direct downloads
from Google are blocked, so larger files must be attached to the chat. Logs contain rider first
names and pickup addresses: keep them in the session scratchpad, never in the repo.

## Next

1. Check the first Uber offers logged on device against screenshots and fix the parser.
2. Confirm Uber day/week detection on device; adjust the colour threshold if needed.
3. Receipts: include photos in the JSON backup; pump displays read poorly and may need typing.
4. Offers are not in the JSON backup yet.
5. Ideas not started: weekly goal, personal bests, a "week is ready" notification, card
   captions, a generic fallback for unknown stats screens, offer analytics by time of day.
6. A Play Store release would need a private signing key and a decision on the app id.
