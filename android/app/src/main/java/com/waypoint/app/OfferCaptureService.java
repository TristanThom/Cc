package com.waypoint.app;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Capture mode for building the ride-offer logger.
 *
 * While the user has switched capture on in Waypoint, this records what the Uber and Lyft
 * driver apps show (screen text, taps, and occasional screenshots) to a log file on the
 * device. It ignores every other app, never taps or types anything, and sends nothing
 * anywhere: the user exports the log from Settings when they choose to.
 */
public class OfferCaptureService extends AccessibilityService {

    private static final long SCREEN_INTERVAL_MONEY_MS = 700;
    private static final long SCREEN_INTERVAL_OTHER_MS = 4000;
    private static final long SHOT_INTERVAL_MONEY_MS = 2000;
    private static final long SHOT_INTERVAL_OTHER_MS = 60000;
    private static final int MAX_NODES = 400;
    private static final int MAX_DEPTH = 60;
    private static final int SHOT_WIDTH = 540;

    private HandlerThread thread;
    private Handler worker;
    private volatile boolean dumpScheduled;
    private long lastScreenAt;
    private long lastShotAt;
    private int lastHash;
    private final Set<String> reportedSkipped = new HashSet<>();

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

        if (e.getEventType() == AccessibilityEvent.TYPE_VIEW_CLICKED) {
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
        }

        // Throttle (not debounce): navigation screens change constantly and must not starve the dump.
        if (!dumpScheduled) {
            dumpScheduled = true;
            worker.postDelayed(this::dumpScreens, 300);
        }
    }

    private void dumpScreens() {
        dumpScheduled = false;
        try {
            long logBytes = CaptureStore.log(this).length();
            if (logBytes > CaptureStore.HARD_CAP_BYTES) return;

            JSONArray nodes = new JSONArray();
            StringBuilder sig = new StringBuilder();
            String pkg = null;
            boolean[] money = { false };

            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows != null) {
                for (AccessibilityWindowInfo w : windows) {
                    AccessibilityNodeInfo root = w.getRoot();
                    if (root == null || root.getPackageName() == null) continue;
                    String p = root.getPackageName().toString();
                    if (!isTarget(p)) continue;
                    pkg = p;
                    collect(root, 0, nodes, sig, money);
                }
            }
            if (pkg == null) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null && root.getPackageName() != null && isTarget(root.getPackageName().toString())) {
                    pkg = root.getPackageName().toString();
                    collect(root, 0, nodes, sig, money);
                }
            }
            if (pkg == null || nodes.length() == 0) return;

            long now = System.currentTimeMillis();
            int hash = sig.toString().hashCode();
            boolean changed = hash != lastHash;
            boolean hasMoney = money[0];

            long minGap = hasMoney ? SCREEN_INTERVAL_MONEY_MS : SCREEN_INTERVAL_OTHER_MS;
            boolean room = hasMoney || logBytes < CaptureStore.SOFT_CAP_BYTES;
            if (changed && room && now - lastScreenAt >= minGap) {
                lastHash = hash;
                lastScreenAt = now;
                JSONObject o = event("screen", pkg);
                o.put("money", hasMoney);
                o.put("nodes", nodes);

                long shotGap = hasMoney ? SHOT_INTERVAL_MONEY_MS : SHOT_INTERVAL_OTHER_MS;
                if (Build.VERSION.SDK_INT >= 30 && now - lastShotAt >= shotGap && CaptureStore.shotCount(this) < CaptureStore.MAX_SHOTS) {
                    lastShotAt = now;
                    String name = now + ".jpg";
                    o.put("shot", name);
                    takeShot(new File(CaptureStore.shotsDir(this), name));
                }
                CaptureStore.append(this, o.toString());
            }
        } catch (Exception ex) {
            write(error("dump_failed", ex));
        }
    }

    /** Depth-first walk collecting every node that carries text, a description, or a tappable id. */
    private void collect(AccessibilityNodeInfo n, int depth, JSONArray out, StringBuilder sig, boolean[] money) {
        if (n == null || depth > MAX_DEPTH || out.length() >= MAX_NODES) return;
        try {
            String text = str(n.getText());
            String desc = str(n.getContentDescription());
            String id = str(n.getViewIdResourceName());
            boolean clickable = n.isClickable();
            if (!text.isEmpty() || !desc.isEmpty() || (clickable && !id.isEmpty())) {
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
                out.put(o);
                sig.append(text).append('|').append(desc).append('|').append(id).append('\n');
                if (text.indexOf('$') >= 0 || desc.indexOf('$') >= 0) money[0] = true;
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                collect(n.getChild(i), depth + 1, out, sig, money);
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
            int h = Math.max(1, soft.getHeight() * SHOT_WIDTH / Math.max(1, soft.getWidth()));
            Bitmap small = Bitmap.createScaledBitmap(soft, SHOT_WIDTH, h, true);
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
        worker.post(() -> CaptureStore.append(this, line));
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
