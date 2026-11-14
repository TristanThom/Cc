package com.waypoint.app;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a stream of Lyft Driver screens into ride offers with outcomes.
 *
 * An offer card is recognised by its reject button. Its outcome comes from what Lyft shows
 * next: "Ride added to queue" or the pickup screen (accepted), "You declined the ride"
 * (declined), or nothing within the resolve window (missed: timed out or taken away).
 *
 * Pure Java so it can be unit-tested off-device.
 */
final class LyftOfferTracker {

    static final long RESOLVE_WINDOW_MS = 25_000;

    private static final Pattern FARE = Pattern.compile("^\\$([\\d,]+(?:\\.\\d{1,2})?)$");
    private static final Pattern BONUS = Pattern.compile("\\$([\\d,]+(?:\\.\\d{1,2})?) bonus", Pattern.CASE_INSENSITIVE);
    private static final Pattern HOURLY = Pattern.compile("^\\$([\\d,]+(?:\\.\\d{1,2})?)/hr");
    private static final Pattern LEG = Pattern.compile("^(?:(\\d+) hr )?(\\d+) min • ([\\d.,]+) (mi|ft)$");
    private static final Pattern RATING = Pattern.compile("^\\d\\.\\d{1,2}$");
    private static final String[] TAG_HINTS = { "Priority Mode", "usually ready", "stars on last ride", "Scheduled", "Shared", "XL", "Extra Comfort", "Lux" };

    private Offer open;
    private boolean cardVisible;

    /** True if the most recent screen showed an offer card. */
    boolean cardVisible() {
        return cardVisible;
    }

    /** True while an offer is waiting for its outcome. */
    boolean hasOpen() {
        return open != null;
    }

    /** Feed one Lyft screen. Returns any offers that were resolved by it (usually none or one). */
    List<Offer> onScreen(long now, List<OfferNode> nodes) {
        List<Offer> done = new ArrayList<>();
        Offer seen = parse(now, nodes);
        cardVisible = seen != null;
        if (seen != null && seen.partial) {
            // A card animating in or out shows the fare but not the route. It can extend the
            // offer already being tracked, but must never start a new one.
            if (open != null && open.fare == seen.fare) {
                open.lastSeen = now;
                return done;
            }
            seen = null;
        }
        if (seen != null) {
            if (open != null && open.key.equals(seen.key)) {
                open.lastSeen = now;
            } else {
                if (open != null) done.add(finish(open, Offer.MISSED, now));
                open = seen;
            }
            return done;
        }
        if (open != null) {
            String outcome = outcomeFrom(nodes, open.queued);
            if (outcome != null) {
                done.add(finish(open, outcome, now));
                open = null;
            } else if (now - open.lastSeen > RESOLVE_WINDOW_MS) {
                done.add(finish(open, Offer.MISSED, now));
                open = null;
            }
        }
        return done;
    }

    /** Call when time passes without a Lyft screen, so a vanished offer still gets closed. */
    List<Offer> tick(long now) {
        List<Offer> done = new ArrayList<>();
        if (open != null && now - open.lastSeen > RESOLVE_WINDOW_MS) {
            done.add(finish(open, Offer.MISSED, now));
            open = null;
            cardVisible = false;
        }
        return done;
    }

    private static Offer finish(Offer o, String outcome, long now) {
        o.outcome = outcome;
        o.resolvedAt = now;
        return o;
    }

    private static String outcomeFrom(List<OfferNode> nodes, boolean queued) {
        for (OfferNode n : nodes) {
            String l = n.label();
            if (l.equals("You declined the ride")) return Offer.DECLINED;
            if (l.equals("Ride added to queue")) return Offer.ACCEPTED;
            // Only a fresh pickup screen counts; when queued, "Pick up" may be the ride already underway.
            if (!queued && l.startsWith("Pick up ")) return Offer.ACCEPTED;
        }
        return null;
    }

    /** Parses the offer card on this screen, or returns null if there is none. */
    static Offer parse(long now, List<OfferNode> nodes) {
        int start = -1;
        for (int i = 0; i < nodes.size(); i++) {
            if (nodes.get(i).id.endsWith("reject_ride_button")) {
                start = i;
                break;
            }
        }
        if (start < 0) return null;
        int end = Math.min(nodes.size(), start + 40);
        boolean hasPrimary = false;
        for (int i = start + 1; i < end; i++) {
            if (nodes.get(i).id.endsWith("primary_button")) {
                end = i;
                hasPrimary = true;
                break;
            }
        }

        Offer o = new Offer();
        o.app = "lyft";
        o.t = now;
        o.lastSeen = now;
        o.id = "lyft-" + now;
        boolean haveFare = false;
        int legs = 0;
        int stops = 0;
        for (int i = start; i < end; i++) {
            OfferNode n = nodes.get(i);
            String l = n.label();
            if (l.isEmpty()) continue;
            Matcher m;
            if (n.id.endsWith("stop_row_content")) {
                if (stops++ == 0) o.pickup = l;
                else o.dropoff = l; // with several stops, the last one wins
            } else if (l.equals("Add to queue")) {
                o.queued = true;
            } else if (!haveFare && (m = FARE.matcher(l)).matches()) {
                o.fare = num(m.group(1));
                haveFare = true;
            } else if ((m = HOURLY.matcher(l)).find()) {
                o.hourly = num(m.group(1));
            } else if ((m = BONUS.matcher(l)).find()) {
                o.bonus = num(m.group(1));
            } else if ((m = LEG.matcher(l)).matches()) {
                int min = (m.group(1) == null ? 0 : Integer.parseInt(m.group(1)) * 60) + Integer.parseInt(m.group(2));
                double mi = num(m.group(3)) / (m.group(4).equals("ft") ? 5280.0 : 1.0);
                if (legs == 0) {
                    o.pickupMin = min;
                    o.pickupMi = mi;
                } else if (legs == 1) {
                    o.tripMin = min;
                    o.tripMi = mi;
                } else {
                    // Extra stops: fold them into the trip.
                    o.tripMin += min;
                    o.tripMi += mi;
                }
                legs++;
            } else if (RATING.matcher(l).matches()) {
                o.riderRating = num(l);
            } else {
                for (String hint : TAG_HINTS) {
                    if (l.contains(hint)) {
                        o.tags.add(l);
                        break;
                    }
                }
            }
        }
        if (!haveFare) return null;
        o.partial = legs == 0 || stops == 0;
        if (hasPrimary && end - 1 > start) {
            String type = nodes.get(end - 1).label();
            if (!type.isEmpty() && !RATING.matcher(type).matches() && !type.equals("Verified")) o.rideType = type;
        }
        // The pickup leg shrinks as the driver moves, so it is left out of the identity.
        o.key = o.fare + "|" + o.pickup + "|" + o.dropoff + "|" + o.tripMin + "|" + o.tripMi;
        return o;
    }

    private static double num(String s) {
        try {
            return Double.parseDouble(s.replace(",", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
