package com.waypoint.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** On-device storage for the offer capture log. Nothing here leaves the phone unless the user shares it. */
final class CaptureStore {

    static final String PREFS = "offer_capture";
    static final String KEY_ENABLED = "enabled";
    static final String LOG_NAME = "events.jsonl";

    /** Text log stops recording ordinary screens here, and everything at the hard cap. */
    static final long SOFT_CAP_BYTES = 50L * 1024 * 1024;
    static final long HARD_CAP_BYTES = 80L * 1024 * 1024;
    static final int MAX_SHOTS = 800;

    private CaptureStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context c) {
        return prefs(c).getBoolean(KEY_ENABLED, false);
    }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "capture");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static File log(Context c) {
        return new File(dir(c), LOG_NAME);
    }

    static File shotsDir(Context c) {
        File d = new File(dir(c), "shots");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static int shotCount(Context c) {
        String[] names = shotsDir(c).list();
        return names == null ? 0 : names.length;
    }

    /** Keeps the newest MAX_SHOTS screenshots, deleting the oldest. File names are timestamps. */
    static void trimShots(Context c) {
        String[] names = shotsDir(c).list();
        if (names == null || names.length < MAX_SHOTS) return;
        java.util.Arrays.sort(names);
        for (int i = 0; i <= names.length - MAX_SHOTS; i++) {
            //noinspection ResultOfMethodCallIgnored
            new File(shotsDir(c), names[i]).delete();
        }
    }

    static synchronized void append(Context c, String jsonLine) {
        try (FileOutputStream out = new FileOutputStream(log(c), true)) {
            out.write(jsonLine.getBytes(StandardCharsets.UTF_8));
            out.write('\n');
        } catch (Exception ignored) {
            // Capture is best-effort; never crash the service over a failed write.
        }
    }

    static synchronized void clear(Context c) {
        File[] shots = shotsDir(c).listFiles();
        if (shots != null) {
            for (File f : shots) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        //noinspection ResultOfMethodCallIgnored
        log(c).delete();
    }
}
