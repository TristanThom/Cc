package com.waypoint.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Shows the active shift in the notification shade with a live timer.
 *
 * The timer is the system's own chronometer counting up from a start instant, so it keeps
 * ticking without the app running or waking the phone. The start instant is pushed later by
 * the shift's break time, so what it shows is the shift length (elapsed minus breaks).
 */
@CapacitorPlugin(name = "ShiftNotifier", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class ShiftNotifierPlugin extends Plugin {

    private static final String CHANNEL = "active_shift";
    private static final int ID = 4100;

    @PluginMethod
    public void show(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            // Android 13+ asks the driver once; the result comes back to afterPermission().
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        post(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            post(call);
        } else {
            JSObject r = new JSObject();
            r.put("shown", false);
            call.resolve(r);
        }
    }

    private void post(PluginCall call) {
        Context c = getContext();
        Long startTs = call.getLong("startTs");
        Integer breakMin = call.getInt("breakMin", 0);
        String title = call.getString("title", "Shift active");
        String text = call.getString("text", "");
        if (startTs == null) {
            call.reject("startTs is required");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Active shift", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows the running shift timer while a shift is active.");
                ch.setShowBadge(false);
                c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
            }
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent tap = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_shift)
                .setContentTitle(title)
                .setContentText(text)
                .setWhen(startTs + (breakMin == null ? 0 : breakMin) * 60_000L)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setColor(0xFF15803D)
                .setContentIntent(tap);
            NotificationManagerCompat.from(c).notify(ID, b.build());
            JSObject r = new JSObject();
            r.put("shown", true);
            call.resolve(r);
        } catch (SecurityException ex) {
            JSObject r = new JSObject();
            r.put("shown", false);
            call.resolve(r);
        } catch (Exception ex) {
            call.reject("Could not show the shift notification", ex);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(ID);
        call.resolve();
    }
}
