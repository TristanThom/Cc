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
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Offer tracking for the Uber and Lyft driver apps.
 *
 * While the user has switched tracking on in Waypoint, this:
 *  - logs every Lyft ride offer with its details and outcome (see LyftOfferTracker);
 *  - records what both driver apps show (screen text, taps, announced text, and a screenshot
 *    when an offer appears) to a capture log, which is the raw material for improving the
 *    parsers, Uber's in particular.
 *
 * It ignores every other app, never taps or types anything, and sends nothing anywhere:
 * the user exports the log from Settings when they choose to.
 */
public class OfferCaptureService extends AccessibilityService {

    /** Minimum gap between logged screens of one app, by how much the screen changed. */
    private static final long GAP_OFFER_MS = 500;
    private static final long GAP_NEW_CONTENT_MS = 1500;
    private static final long GAP_NUMBERS_ONLY_MS = 10_000;

    private static final long SHOT_REPEAT_MS = 6000;
    private static final long SHOT_AFTER_OFFER_MS = 1200;
    private static final long SHOT_INTERVAL_UNREADABLE_MS = 5000;
    private static final int MAX_NODES = 400;
    private static final int MAX_DEPTH = 60;
    private static final int SHOT_WIDTH = 540;
    private static final int WIDE_SCREEN_PX = 1400;

    private static final String[] APPS = { "uber", "lyft" };
    /** Uber offer cards carry a leg such as "9 min • 1.5 mi"; its navigation screens do not. */
    private static final Pattern UBER_LEG = Pattern.compile("\\d+ mins? • [\\d.,]+ (mi|ft)");

    private HandlerThread thread;
    private Handler worker;
    private volatile boolean dumpScheduled;
    private final Set<String> reportedSkipped = new HashSet<>();
    private final Map<String, String> lastEventText = new HashMap<>();

    // Worker-thread state.
    private final LyftOfferTracker lyft = new LyftOfferTracker();
    private final Map<String, Integer> lastHash = new HashMap<>();
    private final Map<String, Integer> lastLooseHash = new HashMap<>();
    private final Map<String, Long> lastScreenAt = new HashMap<>();
    private boolean offerWasVisible;
    private long offerEndedAt;
    private boolean afterShotPending;
    private long lastShotAt;

    @Override
    protected void onServiceConnected() {
        thread = new HandlerThread("offer-capture");
        thread.start();
        worker = new Handler(thread.getLooper());
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
        } else {
            // Some screens (Uber's offer card among them) hide their parts from the node tree
            // but still announce their text through the event itself, so keep that too.
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
        if (!dumpScheduled) {
            dumpScheduled = true;
            worker.postDelayed(this::dumpScreens, 300);
        }
    }

    /** What one driver app is showing right now. */
    private static final class AppScreen {
        final JSONArray nodes = new JSONArray();
        final List<OfferNode> plain = new ArrayList<>();
        final StringBuilder sig = new StringBuilder();
        boolean present;
    }

    private void dumpScreens() {
        dumpScheduled = false;
        try {
            long now = System.currentTimeMillis();
            Map<String, AppScreen> screens = new HashMap<>();
            for (String app : APPS) screens.put(app, new AppScreen());

            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows != null) {
                for (AccessibilityWindowInfo w : windows) {
                    AccessibilityNodeInfo root = w.getRoot();
                    if (root == null || root.getPackageName() == null) continue;
                    String p = root.getPackageName().toString();
                    if (!isTarget(p)) continue;
                    AppScreen s = screens.get(appName(p));
                    s.present = true;
                    // Each window gets its own node budget so one busy screen cannot crowd out another.
                    collect(root, 0, s, s.nodes.length() + MAX_NODES);
                }
            }
            AppScreen uber = screens.get("uber");
            AppScreen lyftScreen = screens.get("lyft");
            if (!uber.present && !lyftScreen.present) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null && root.getPackageName() != null && isTarget(root.getPackageName().toString())) {
                    AppScreen s = screens.get(appName(root.getPackageName().toString()));
                    s.present = true;
                    collect(root, 0, s, MAX_NODES);
                }
            }

            // 1. Offer logging. Runs on every screen, independent of the capture log's limits.
            List<Offer> resolved = lyftScreen.present && lyftScreen.plain.size() > 0 ? lyft.onScreen(now, lyftScreen.plain) : lyft.tick(now);
            for (Offer o : resolved) OfferStore.append(this, o);

            if (!uber.present && !lyftScreen.present) return;

            boolean lyftOffer = lyftScreen.present && lyft.cardVisible();
            boolean uberOffer = uber.present && looksLikeUberOffer(uber.plain);
            boolean offerVisible = lyftOffer || uberOffer;

            // 2. Capture log, one entry per app whose screen changed.
            boolean underCap = CaptureStore.log(this).length() < CaptureStore.HARD_CAP_BYTES;
            for (String app : APPS) {
                AppScreen s = screens.get(app);
                if (!s.present || s.nodes.length() == 0 || !underCap) continue;
                boolean offer = app.equals("lyft") ? lyftOffer : uberOffer;
                String sig = s.sig.toString();
                int hash = sig.hashCode();
                int loose = sig.replaceAll("[0-9]", "").hashCode();
                Integer prev = lastHash.get(app);
                if (prev != null && prev == hash) continue;
                Integer prevLoose = lastLooseHash.get(app);
                long gap = offer ? GAP_OFFER_MS : (prevLoose == null || prevLoose != loose) ? GAP_NEW_CONTENT_MS : GAP_NUMBERS_ONLY_MS;
                Long at = lastScreenAt.get(app);
                if (at != null && now - at < gap) continue;
                lastHash.put(app, hash);
                lastLooseHash.put(app, loose);
                lastScreenAt.put(app, now);

                JSONObject o = event("screen", app);
                DisplayMetrics dm = getResources().getDisplayMetrics();
                o.put("display", dm.widthPixels + "x" + dm.heightPixels);
                o.put("offer", offer);
                o.put("nodes", s.nodes);
                CaptureStore.append(this, o.toString());
            }

            // 3. Screenshots: when an offer appears, while it stays up, and once just after it goes.
            boolean unreadable = (uber.present && uber.nodes.length() == 0) || (lyftScreen.present && lyftScreen.nodes.length() == 0);
            String reason = null;
            if (offerVisible) {
                if (!offerWasVisible || now - lastShotAt >= SHOT_REPEAT_MS) reason = "offer";
                afterShotPending = true;
            } else {
                if (offerWasVisible) offerEndedAt = now;
                if (afterShotPending && now - offerEndedAt >= SHOT_AFTER_OFFER_MS) {
                    reason = "after_offer";
                    afterShotPending = false;
                } else if (unreadable && now - lastShotAt >= SHOT_INTERVAL_UNREADABLE_MS) {
                    // A driver app is on screen but exposes no text, so pictures are the only record.
                    reason = "unreadable";
                }
            }
            offerWasVisible = offerVisible;
            if (reason != null && Build.VERSION.SDK_INT >= 30) {
                lastShotAt = now;
                String name = now + ".jpg";
                JSONObject o = event("shot", getPackageName());
                o.put("name", name);
                o.put("reason", reason);
                o.put("lyftOffer", lyftOffer);
                o.put("uberOffer", uberOffer);
                CaptureStore.append(this, o.toString());
                CaptureStore.trimShots(this);
                takeShot(new File(CaptureStore.shotsDir(this), name));
            }

            // An offer that has gone still needs its "after" picture and its timeout check even
            // if the apps stop producing events, so look again shortly.
            if (((afterShotPending && !offerVisible) || lyft.hasOpen()) && !dumpScheduled) {
                dumpScheduled = true;
                worker.postDelayed(this::dumpScreens, 1500);
            }
        } catch (Exception ex) {
            write(error("dump_failed", ex));
        }
    }

    private static boolean looksLikeUberOffer(List<OfferNode> nodes) {
        for (OfferNode n : nodes) {
            String l = n.label();
            if (l.equals("Match") || l.equals("Accept") || UBER_LEG.matcher(l).find()) return true;
        }
        return false;
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
                if (!id.isEmpty()) o.put("id", id);
                if (clickable) o.put("click", true);
                String cls = str(n.getClassName());
                o.put("cls", cls.substring(cls.lastIndexOf('.') + 1));
                Rect r = new Rect();
                n.getBoundsInScreen(r);
                o.put("bounds", r.flattenToString());
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

    @RequiresApi(30)
    private void takeShot(final File file) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(@NonNull final ScreenshotResult result) {
                    worker.post(() -> saveShot(result, file));
                }

                @Override
                public void onFailure(int errorCode) {
                    JSONObject o = event("shot_failed", getPackageName());
                    try {
                        o.put("code", errorCode);
                    } catch (Exception ignored) {}
                    write(o);
                }
            });
        } catch (Exception ex) {
            write(error("shot_failed", ex));
        }
    }

    @RequiresApi(30)
    private void saveShot(ScreenshotResult result, File file) {
        try (HardwareBuffer buffer = result.getHardwareBuffer()) {
            Bitmap hw = Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
            if (hw == null) return;
            Bitmap soft = hw.copy(Bitmap.Config.ARGB_8888, false);
            hw.recycle();
            if (soft == null) return;
            // Wide screens (an unfolded phone with two apps side by side) keep twice the width so
            // each app is still legible.
            int w = soft.getWidth() >= WIDE_SCREEN_PX ? SHOT_WIDTH * 2 : SHOT_WIDTH;
            int h = Math.max(1, soft.getHeight() * w / Math.max(1, soft.getWidth()));
            Bitmap small = Bitmap.createScaledBitmap(soft, w, h, true);
            try (FileOutputStream out = new FileOutputStream(file)) {
                small.compress(Bitmap.CompressFormat.JPEG, 60, out);
            }
            if (small != soft) small.recycle();
            soft.recycle();
        } catch (Exception ex) {
            write(error("shot_save_failed", ex));
        }
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
