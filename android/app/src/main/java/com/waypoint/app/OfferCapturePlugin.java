package com.waypoint.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Bridge between the Waypoint UI and the offer capture service. */
@CapacitorPlugin(name = "OfferCapture")
public class OfferCapturePlugin extends Plugin {

    private JSObject statusObject() {
        Context c = getContext();
        File log = CaptureStore.log(c);
        JSObject r = new JSObject();
        r.put("enabled", CaptureStore.enabled(c));
        r.put("serviceOn", serviceOn(c));
        r.put("logBytes", log.exists() ? log.length() : 0);
        r.put("lastEventAt", log.exists() ? log.lastModified() : 0);
        r.put("shots", CaptureStore.shotCount(c));
        r.put("offers", OfferStore.readLines(c).size());
        return r;
    }

    /** True when the user has switched Waypoint on under Android's Accessibility settings. */
    private static boolean serviceOn(Context c) {
        String on = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (on == null) return false;
        for (String entry : on.split(":")) {
            if (entry.startsWith(c.getPackageName() + "/") && entry.endsWith("OfferCaptureService")) return true;
        }
        return false;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        CaptureStore.prefs(getContext()).edit().putBoolean(CaptureStore.KEY_ENABLED, enabled).apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            getContext().startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception ex) {
            call.reject("Could not open Accessibility settings", ex);
        }
    }

    @PluginMethod
    public void openAppInfo(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            getContext().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception ex) {
            call.reject("Could not open app info", ex);
        }
    }

    /** Zips the log (and optionally the screenshots) into the cache dir so it can be shared. */
    @PluginMethod
    public void exportZip(final PluginCall call) {
        final boolean withShots = Boolean.TRUE.equals(call.getBoolean("shots", false));
        final Context c = getContext();
        new Thread(() -> {
            try {
                File log = CaptureStore.log(c);
                if (!log.exists() || log.length() == 0) {
                    call.reject("Nothing captured yet");
                    return;
                }
                File zip = new File(c.getCacheDir(), "waypoint-capture" + (withShots ? "-with-screenshots" : "") + ".zip");
                try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(zip))) {
                    add(out, log, CaptureStore.LOG_NAME);
                    File offers = OfferStore.file(c);
                    if (offers.exists()) add(out, offers, OfferStore.FILE_NAME);
                    if (withShots) {
                        File[] shots = CaptureStore.shotsDir(c).listFiles();
                        if (shots != null) {
                            for (File f : shots) add(out, f, "shots/" + f.getName());
                        }
                    }
                }
                JSObject r = new JSObject();
                r.put("uri", Uri.fromFile(zip).toString());
                r.put("bytes", zip.length());
                call.resolve(r);
            } catch (Exception ex) {
                call.reject("Export failed: " + ex.getMessage(), ex);
            }
        }).start();
    }

    private static void add(ZipOutputStream out, File f, String name) throws Exception {
        out.putNextEntry(new ZipEntry(name));
        try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(f))) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        out.closeEntry();
    }

    /** The stored ride offers, oldest first. */
    @PluginMethod
    public void offers(PluginCall call) {
        JSArray arr = new JSArray();
        for (String line : OfferStore.readLines(getContext())) {
            try {
                arr.put(new JSObject(line));
            } catch (Exception ignored) {
                // Skip a damaged line rather than lose the whole history.
            }
        }
        JSObject r = new JSObject();
        r.put("offers", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void clearOffers(PluginCall call) {
        OfferStore.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        CaptureStore.clear(getContext());
        call.resolve(statusObject());
    }
}
