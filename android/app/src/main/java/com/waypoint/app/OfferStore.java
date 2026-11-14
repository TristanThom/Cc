package com.waypoint.app;

import android.content.Context;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** The driver's ride-offer history: one small JSON record per line, kept on the device. */
final class OfferStore {

    static final String FILE_NAME = "offers.jsonl";

    private OfferStore() {}

    static File file(Context c) {
        return new File(c.getFilesDir(), FILE_NAME);
    }

    static JSONObject toJson(Offer o) throws Exception {
        JSONObject j = new JSONObject();
        j.put("id", o.id);
        j.put("app", o.app);
        j.put("t", o.t);
        j.put("resolvedAt", o.resolvedAt);
        j.put("outcome", o.outcome);
        j.put("fare", o.fare);
        j.put("bonus", o.bonus);
        j.put("hourly", o.hourly);
        j.put("pickupMin", o.pickupMin);
        j.put("pickupMi", o.pickupMi);
        j.put("tripMin", o.tripMin);
        j.put("tripMi", o.tripMi);
        j.put("pickup", o.pickup);
        j.put("dropoff", o.dropoff);
        j.put("rideType", o.rideType);
        j.put("riderRating", o.riderRating);
        j.put("queued", o.queued);
        j.put("tags", new JSONArray(o.tags));
        return j;
    }

    static synchronized void append(Context c, Offer o) {
        try (FileOutputStream out = new FileOutputStream(file(c), true)) {
            out.write(toJson(o).toString().getBytes(StandardCharsets.UTF_8));
            out.write('\n');
        } catch (Exception ignored) {
            // Best-effort; never crash the service over a failed write.
        }
    }

    /** All stored offers, oldest first, as raw JSON lines. */
    static synchronized List<String> readLines(Context c) {
        List<String> lines = new ArrayList<>();
        File f = file(c);
        if (!f.exists()) return lines;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (!line.isEmpty()) lines.add(line);
            }
        } catch (Exception ignored) {}
        return lines;
    }

    static synchronized void clear(Context c) {
        //noinspection ResultOfMethodCallIgnored
        file(c).delete();
    }
}
