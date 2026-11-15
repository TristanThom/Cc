package com.waypoint.app;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Offer tracking for the Uber and Lyft driver apps.
 *
 * While the user has switched tracking on in Waypoint, this:
 *  - logs every Lyft ride offer from the card's text (LyftOfferTracker);
 *  - logs every Uber ride offer by screenshotting Uber's own window when a card is likely to
 *    be up and reading the card on the phone (UberOfferParser, UberOfferTracker), because
 *    Uber hides the card's text;
 *  - keeps a capture log of what both apps show, used to improve these parsers.
 *
 * Privacy rules it enforces: only full-size windows belonging to the two driver apps are
 * read; every screenshot is cropped to those windows; nothing is captured while another app
 * covers them; it never taps or types; nothing leaves the phone unless the user shares it.
 */
public class OfferCaptureService extends AccessibilityService {

    /** Minimum gap between logged screens of one app. */
    private static final long GAP_OFFER_MS = 500;
    private static final long GAP_UBER_MS = 8000;
    private static final long GAP_LYFT_MS = 20_000;

    private static final long SHOT_REPEAT_MS = 6000;
    private static final long SHOT_AFTER_OFFER_MS = 1200;
    private static final long UBER_SCAN_MS = 1500;
    private static final long UBER_SCAN_SLOW_MS = 6000;
    private static final int UBER_SCAN_MISSES_BEFORE_SLOW = 6;
    /** Uber's screen shrinks to this many elements or fewer while an offer card covers it. */
    private static final int UBER_CARD_MAX_NODES = 8;
    private static final int MAX_NODES = 400;
    private static final int MAX_DEPTH = 60;
    private static final int SHOT_WIDTH = 540;
    private static final int OCR_MAX_WIDTH = 1100;
    /** A driver-app window smaller than this share of the screen is a bubble or pop-up; ignore it. */
    private static final double MIN_WINDOW_SHARE = 0.15;
    private static final double MAX_COVERED_SHARE = 0.3;

    private static final String[] APPS = { "uber", "lyft" };

    private HandlerThread thread;
    private Handler worker;
    private Executor workerExecutor;
    private volatile boolean dumpScheduled;
    private final Set<String> reportedSkipped = new HashSet<>();
    private final Map<String, String> lastEventText = new HashMap<>();

    // Worker-thread state.
    private final LyftOfferTracker lyft = new LyftOfferTracker();
    private final UberOfferTracker uberOffers = new UberOfferTracker();
    private final Map<String, Integer> lastHash = new HashMap<>();
    private final Map<String, Long> lastScreenAt = new HashMap<>();
    private boolean lyftOfferWasVisible;
    private long lyftOfferEndedAt;
    private boolean afterShotPending;
    private long lastShotAt;
    private boolean uberScanning;
    private long lastUberScanAt;
    private int uberScanMisses;
    private int lastOcrHash;
    private long lastCoveredNoteAt;

    @Override
    protected void onServiceConnected() {
        thread = new HandlerThread("offer-capture");
        thread.start();
        worker = new Handler(thread.getLooper());
        workerExecutor = worker::post;
        write(event("service_connected", getPackageName()));
    }

    @Override
    public void onDestroy() {
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {}

    /** Only the Uber and Lyft driver apps are ever recorded. */
    private static boolean isTarget(String pkg) {
        return pkg.contains("driver") && (pkg.contains("uber") || pkg.contains("lyft"));
    }

    private static String appName(String pkg) {
        return pkg.contains("lyft") ? "lyft" : "uber";
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (worker == null || e == null || e.getPackageName() == null) return;
        if (!CaptureStore.enabled(this)) return;
        String pkg = e.getPackageName().toString();
        if (!isTarget(pkg)) {
            // Diagnostic only: note the name of an Uber/Lyft package we are not recording.
            if ((pkg.contains("uber") || pkg.contains("lyft")) && reportedSkipped.add(pkg)) {
                write(event("skipped_package", pkg));
            }
            return;
        }

        int type = e.getEventType();
        if (type == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            JSONObject o = event("click", pkg);
            try {
                o.put("text", joinText(e.getText()));
                o.put("desc", str(e.getContentDescription()));
                o.put("cls", str(e.getClassName()));
                AccessibilityNodeInfo src = e.getSource();
                if (src != null) {
                    o.put("id", str(src.getViewIdResourceName()));
                    Rect r = new Rect();
                    src.getBoundsInScreen(r);
                    o.put("bounds", r.flattenToString());
                }
            } catch (Exception ignored) {}
            write(o);
        } else if (type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            // Window changes, notifications and announcements sometimes carry text the node
            // tree does not. (Content-changed events were tried and are only tile noise.)
            String text = joinText(e.getText());
            String desc = str(e.getContentDescription());
            String said = text.isEmpty() ? desc : text;
            if (!said.isEmpty() && !said.equals(lastEventText.get(pkg))) {
                lastEventText.put(pkg, said);
                JSONObject o = event("event", pkg);
                try {
                    o.put("etype", type);
                    o.put("text", text);
                    o.put("desc", desc);
                    o.put("cls", str(e.getClassName()));
                } catch (Exception ignored) {}
                write(o);
            }
        }

        // Throttle (not debounce): navigation screens change constantly and must not starve the dump.
        scheduleDump(300);
    }

    private void scheduleDump(long delayMs) {
        if (dumpScheduled || worker == null) return;
        dumpScheduled = true;
        worker.postDelayed(this::dumpScreens, delayMs);
    }

    /** What one driver app is showing right now. */
    private static final class AppScreen {
        final JSONArray nodes = new JSONArray();
        final List<OfferNode> plain = new ArrayList<>();
        final StringBuilder sig = new StringBuilder();
        final Rect bounds = new Rect();
        int layer = -1;
        boolean present;
    }

    private static long area(Rect r) {
        return (long) Math.max(0, r.width()) * Math.max(0, r.height());
    }

    private void dumpScreens() {
        dumpScheduled = false;
        try {
            long now = System.currentTimeMillis();
            DisplayMetrics dm = getResources().getDisplayMetrics();
            long screenArea = (long) dm.widthPixels * dm.heightPixels;
            Map<String, AppScreen> screens = new HashMap<>();
            for (String app : APPS) screens.put(app, new AppScreen());
            List<Rect> otherBounds = new ArrayList<>();
            List<Integer> otherLayers = new ArrayList<>();

            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows != null) {
                for (AccessibilityWindowInfo w : windows) {
                    // Overlays, bubbles, the keyboard and system bars are never read.
                    if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                    Rect b = new Rect();
                    w.getBoundsInScreen(b);
                    AccessibilityNodeInfo root = w.getRoot();
                    String p = root == null || root.getPackageName() == null ? "" : root.getPackageName().toString();
                    if (!isTarget(p)) {
                        otherBounds.add(b);
                        otherLayers.add(w.getLayer());
                        continue;
                    }
                    if (area(b) < screenArea * MIN_WINDOW_SHARE) continue;
                    AppScreen s = screens.get(appName(p));
                    s.present = true;
                    s.bounds.union(b);
                    s.layer = Math.max(s.layer, w.getLayer());
                    // Each window gets its own node budget so one busy screen cannot crowd out another.
                    collect(root, 0, s, s.nodes.length() + MAX_NODES);
                }
            }
            // A driver app with another app drawn over it is treated as not on screen at all.
            for (String app : APPS) {
                AppScreen s = screens.get(app);
                if (!s.present) continue;
                long covered = 0;
                for (int i = 0; i < otherBounds.size(); i++) {
                    Rect o = new Rect(otherBounds.get(i));
                    if (otherLayers.get(i) > s.layer && o.intersect(s.bounds)) covered += area(o);
                }
                if (covered > area(s.bounds) * MAX_COVERED_SHARE) {
                    s.present = false;
                    if (now - lastCoveredNoteAt > 60_000) {
                        lastCoveredNoteAt = now;
                        write(event("covered", app));
                    }
                }
            }
            AppScreen uber = screens.get("uber");
            AppScreen lyftScreen = screens.get("lyft");

            // 1. Offer logging from readable text. Independent of the capture log's limits.
            List<Offer> resolved = lyftScreen.present && lyftScreen.plain.size() > 0 ? lyft.onScreen(now, lyftScreen.plain) : lyft.tick(now);
            resolved.addAll(uber.present && uber.plain.size() > 0 ? uberOffers.onScreen(now, uber.plain) : uberOffers.tick(now));
            for (Offer o : resolved) OfferStore.append(this, o);

            if (!uber.present && !lyftScreen.present) return;

            boolean lyftOffer = lyftScreen.present && lyft.cardVisible();
            // Uber hides its card: the tell is its screen collapsing to a few elements, or none.
            boolean uberSuspect = uber.present && uber.plain.size() <= UBER_CARD_MAX_NODES;

            // 2. Capture log, one entry per app whose screen changed.
            boolean underCap = CaptureStore.log(this).length() < CaptureStore.HARD_CAP_BYTES;
            for (String app : APPS) {
                AppScreen s = screens.get(app);
                if (!s.present || s.nodes.length() == 0 || !underCap) continue;
                boolean offer = app.equals("lyft") ? lyftOffer : uberSuspect;
                // Digits are ignored so clocks, countdowns and distances do not count as changes.
                int hash = s.sig.toString().replaceAll("[0-9]", "").hashCode();
                Integer prev = lastHash.get(app);
                if (prev != null && prev == hash && !offer) continue;
                long gap = offer ? GAP_OFFER_MS : app.equals("lyft") ? GAP_LYFT_MS : GAP_UBER_MS;
                Long at = lastScreenAt.get(app);
                if (at != null && now - at < gap) continue;
                lastHash.put(app, hash);
                lastScreenAt.put(app, now);

                JSONObject o = event("screen", app);
                o.put("display", dm.widthPixels + "x" + dm.heightPixels);
                o.put("window", s.bounds.flattenToString());
                o.put("offer", offer);
                o.put("nodes", s.nodes);
                CaptureStore.append(this, o.toString());
            }

            // The area screenshots may show: the driver apps' own windows and nothing else.
            Rect crop = new Rect();
            if (uber.present) crop.union(uber.bounds);
            if (lyftScreen.present) crop.union(lyftScreen.bounds);

            // 3. Lyft offer screenshots: when a card appears, while it stays up, and once after.
            String reason = null;
            if (lyftOffer) {
                if (!lyftOfferWasVisible || now - lastShotAt >= SHOT_REPEAT_MS) reason = "offer";
                afterShotPending = true;
            } else {
                if (lyftOfferWasVisible) lyftOfferEndedAt = now;
                if (afterShotPending && now - lyftOfferEndedAt >= SHOT_AFTER_OFFER_MS) {
                    reason = "after_offer";
                    afterShotPending = false;
                }
            }
            lyftOfferWasVisible = lyftOffer;
            if (reason != null && Build.VERSION.SDK_INT >= 30 && !crop.isEmpty()) {
                lastShotAt = now;
                String name = now + ".jpg";
                JSONObject o = event("shot", "lyft");
                o.put("name", name);
                o.put("reason", reason);
                CaptureStore.append(this, o.toString());
                CaptureStore.trimShots(this);
                takeShot(new File(CaptureStore.shotsDir(this), name), crop);
            }

            // 4. Uber: read the card off the screen.
            if (uberSuspect && !uberScanning && Build.VERSION.SDK_INT >= 30) {
                long gap = uberScanMisses >= UBER_SCAN_MISSES_BEFORE_SLOW ? UBER_SCAN_SLOW_MS : UBER_SCAN_MS;
                if (now - lastUberScanAt >= gap) {
                    lastUberScanAt = now;
                    uberScanning = true;
                    scanUber(new Rect(uber.bounds), now);
                }
            }
            if (!uberSuspect) uberScanMisses = 0;

            // Keep looking while something is unresolved, even if the apps go quiet.
            if (lyft.hasOpen() || uberOffers.hasOpen() || (afterShotPending && !lyftOffer)) {
                scheduleDump(1500);
            } else if (uberSuspect) {
                // A screen that keeps looking like a card but never reads as one (a menu, a
                // loading page) is checked less often, to save battery.
                scheduleDump(uberScanMisses >= UBER_SCAN_MISSES_BEFORE_SLOW ? UBER_SCAN_SLOW_MS : UBER_SCAN_MS);
            }
        } catch (Exception ex) {
            write(error("dump_failed", ex));
        }
    }

    /** Depth-first walk collecting every node that carries text, a description, or a tappable id. */
    private void collect(AccessibilityNodeInfo n, int depth, AppScreen s, int limit) {
        if (n == null || depth > MAX_DEPTH || s.nodes.length() >= limit) return;
        try {
            String text = str(n.getText());
            String desc = str(n.getContentDescription());
            String id = str(n.getViewIdResourceName());
            boolean clickable = n.isClickable();
            // Uber's surge labels on the map change constantly and say nothing about offers.
            boolean mapNoise = id.endsWith("/map_marker") || id.endsWith("/map_marker_title");
            if (!mapNoise && (!text.isEmpty() || !desc.isEmpty() || (clickable && !id.isEmpty()))) {
                JSONObject o = new JSONObject();
                if (!text.isEmpty()) o.put("text", text);
                if (!desc.isEmpty()) o.put("desc", desc);
                if (!id.isEmpty()) o.put("id", id.substring(id.lastIndexOf('/') + 1));
                if (clickable) o.put("click", true);
                s.nodes.put(o);
                s.plain.add(new OfferNode(text, desc, id));
                s.sig.append(text).append('|').append(desc).append('|').append(id).append('\n');
            }
            if (mapNoise) return;
            for (int i = 0; i < n.getChildCount(); i++) {
                collect(n.getChild(i), depth + 1, s, limit);
            }
        } catch (Exception ignored) {
            // Nodes can go stale mid-walk; skip the subtree.
        }
    }

    /* ---------------------------- screenshots ---------------------------- */

    /** Copies the screenshot into a normal bitmap, cropped to `crop` (clamped to the image). */
    @RequiresApi(30)
    private static Bitmap grab(ScreenshotResult result, Rect crop) {
        try (HardwareBuffer buffer = result.getHardwareBuffer()) {
            Bitmap hw = Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
            if (hw == null) return null;
            Bitmap soft = hw.copy(Bitmap.Config.ARGB_8888, false);
            hw.recycle();
            if (soft == null) return null;
            Rect r = new Rect(crop);
            if (!r.intersect(0, 0, soft.getWidth(), soft.getHeight()) || r.width() < 50 || r.height() < 50) {
                soft.recycle();
                return null;
            }
            if (r.width() == soft.getWidth() && r.height() == soft.getHeight()) return soft;
            Bitmap cut = Bitmap.createBitmap(soft, r.left, r.top, r.width(), r.height());
            if (cut != soft) soft.recycle();
            return cut;
        }
    }

    private static Bitmap scaleToWidth(Bitmap src, int maxWidth) {
        if (src.getWidth() <= maxWidth) return src;
        int h = Math.max(1, src.getHeight() * maxWidth / src.getWidth());
        Bitmap out = Bitmap.createScaledBitmap(src, maxWidth, h, true);
        if (out != src) src.recycle();
        return out;
    }

    private void saveJpeg(Bitmap bmp, File file, int maxWidth) {
        try {
            Bitmap small = bmp.getWidth() > maxWidth ? Bitmap.createScaledBitmap(bmp, maxWidth, Math.max(1, bmp.getHeight() * maxWidth / bmp.getWidth()), true) : bmp;
            try (FileOutputStream out = new FileOutputStream(file)) {
                small.compress(Bitmap.CompressFormat.JPEG, 60, out);
            }
            if (small != bmp) small.recycle();
        } catch (Exception ex) {
            write(error("shot_save_failed", ex));
        }
    }

    private void shotFailed(int code) {
        JSONObject o = event("shot_failed", getPackageName());
        try {
            o.put("code", code);
        } catch (Exception ignored) {}
        write(o);
    }

    /** Saves a screenshot of the driver apps' windows only. */
    @RequiresApi(30)
    private void takeShot(final File file, final Rect crop) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(@NonNull final ScreenshotResult result) {
                    worker.post(() -> {
                        try {
                            Bitmap bmp = grab(result, crop);
                            if (bmp == null) return;
                            // Two apps side by side keep twice the width so each stays legible.
                            saveJpeg(bmp, file, bmp.getWidth() >= 1400 ? SHOT_WIDTH * 2 : SHOT_WIDTH);
                            bmp.recycle();
                        } catch (Exception ex) {
                            write(error("shot_save_failed", ex));
                        }
                    });
                }

                @Override
                public void onFailure(int errorCode) {
                    shotFailed(errorCode);
                }
            });
        } catch (Exception ex) {
            write(error("shot_failed", ex));
        }
    }

    /** Screenshots Uber's window, reads its text on-device, and logs an offer card if one is up. */
    @RequiresApi(30)
    private void scanUber(final Rect uberBounds, final long now) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(@NonNull final ScreenshotResult result) {
                    worker.post(() -> {
                        Bitmap bmp = null;
                        try {
                            bmp = grab(result, uberBounds);
                        } catch (Exception ex) {
                            write(error("uber_scan_failed", ex));
                        }
                        if (bmp == null) {
                            uberScanning = false;
                            return;
                        }
                        final Bitmap image = scaleToWidth(bmp, OCR_MAX_WIDTH);
                        TextReader.read(image, workerExecutor, new TextReader.Callback() {
                            @Override
                            public void onLines(List<OcrLine> lines) {
                                try {
                                    onUberText(now, lines, image);
                                } catch (Exception ex) {
                                    write(error("uber_scan_failed", ex));
                                } finally {
                                    image.recycle();
                                    uberScanning = false;
                                }
                            }

                            @Override
                            public void onError(Exception e) {
                                write(error("uber_ocr_failed", e));
                                image.recycle();
                                uberScanning = false;
                            }
                        });
                    });
                }

                @Override
                public void onFailure(int errorCode) {
                    shotFailed(errorCode);
                    uberScanning = false;
                }
            });
        } catch (Exception ex) {
            write(error("uber_scan_failed", ex));
            uberScanning = false;
        }
    }

    private void onUberText(long now, List<OcrLine> lines, Bitmap image) throws Exception {
        Offer card = UberOfferParser.parse(now, lines);

        // Keep the recognised text (not the image) so the parser can be improved from real reads.
        StringBuilder all = new StringBuilder();
        JSONArray arr = new JSONArray();
        for (int i = 0; i < lines.size() && i < 80; i++) {
            OcrLine l = lines.get(i);
            all.append(l.text).append('\n');
            arr.put(new JSONArray().put(l.text).put(l.left).put(l.top).put(l.height()));
        }
        int hash = all.toString().replaceAll("[0-9]", "").hashCode();
        if ((card != null || hash != lastOcrHash) && CaptureStore.log(this).length() < CaptureStore.HARD_CAP_BYTES) {
            lastOcrHash = hash;
            JSONObject o = event("ocr", "uber");
            o.put("card", card != null);
            o.put("size", image.getWidth() + "x" + image.getHeight());
            o.put("lines", arr);
            CaptureStore.append(this, o.toString());
        }

        if (card == null) {
            uberScanMisses++;
            return;
        }
        uberScanMisses = 0;
        boolean isNew = !uberOffers.isOpen(card);
        for (Offer done : uberOffers.onCard(now, card)) OfferStore.append(this, done);
        if (isNew) {
            // One picture per offer, of Uber's window only.
            String name = now + ".jpg";
            JSONObject o = event("shot", "uber");
            o.put("name", name);
            o.put("reason", "uber_offer");
            CaptureStore.append(this, o.toString());
            CaptureStore.trimShots(this);
            saveJpeg(image, new File(CaptureStore.shotsDir(this), name), SHOT_WIDTH);
        }
        scheduleDump(1500);
    }

    /* ------------------------------ helpers ------------------------------ */

    private void write(final JSONObject o) {
        if (worker == null) return;
        final String line = o.toString();
        worker.post(() -> {
            // Taps and announcements are tiny; let them through a little past the screen cap.
            if (CaptureStore.log(this).length() < CaptureStore.HARD_CAP_BYTES + 5L * 1024 * 1024) CaptureStore.append(this, line);
        });
    }

    private static JSONObject event(String type, String pkg) {
        JSONObject o = new JSONObject();
        try {
            o.put("t", System.currentTimeMillis());
            o.put("type", type);
            o.put("pkg", pkg);
        } catch (Exception ignored) {}
        return o;
    }

    private JSONObject error(String type, Exception ex) {
        JSONObject o = event(type, getPackageName());
        try {
            o.put("error", String.valueOf(ex));
            o.put("at", Arrays.toString(Arrays.copyOf(ex.getStackTrace(), Math.min(3, ex.getStackTrace().length))));
        } catch (Exception ignored) {}
        return o;
    }

    private static String str(CharSequence s) {
        return s == null ? "" : s.toString();
    }

    private static String joinText(List<CharSequence> parts) {
        if (parts == null) return "";
        StringBuilder b = new StringBuilder();
        for (CharSequence p : parts) {
            if (p == null) continue;
            if (b.length() > 0) b.append(" | ");
            b.append(p);
        }
        return b.toString();
    }
}
