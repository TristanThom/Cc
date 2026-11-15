package com.waypoint.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads an Uber Driver offer card from text recognised in a screenshot.
 *
 * Uber hides the card from accessibility, so unlike Lyft it has to be read from pixels.
 * A card looks like (top to bottom):
 *
 *   UberX [Exclusive]
 *   $6.69
 *   5% Pro Perk included
 *   9 min • 1.7 mi            <- pickup leg
 *   Ann St & Transit Mall, Charleston
 *   ★ 4.95  [Verified]
 *   [1 stop]
 *   8 mins • 1.6 mi           <- trip leg
 *   Moultrie St & Sutherland Ct, Charleston
 *   [ Match ] or [ Accept ]
 *
 * Text recognition is imperfect, so the rules are loose about punctuation and strict about
 * structure: a fare above two legs, plus a ride type or a button. Pure Java, unit-tested.
 */
final class UberOfferParser {

    private static final Pattern LEG = Pattern.compile("^(?:(\\d+)\\s*hrs?\\s*)?(\\d{1,3})\\s*mins?\\b\\W{0,4}(\\d{1,3}(?:[.,]\\d)?)\\s*(mi|ft)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern FARE = Pattern.compile("^\\$\\s?(\\d{1,3}[.,]\\d{2})(?!\\d)");
    private static final Pattern TYPE = Pattern.compile("^(Uber\\s?[A-Za-z]*(?:\\s(?:Priority|Comfort|Pet|Black|Green|Share|Reserve|Electric))*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern RATING = Pattern.compile("(?<![\\d.])([1-5][.,]\\d{2})(?![\\d])");
    private static final Pattern STOPS = Pattern.compile("^(\\d)\\s*stops?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern BUTTON = Pattern.compile("^(Match|Accept)$", Pattern.CASE_INSENSITIVE);

    private UberOfferParser() {}

    /** Returns the offer on screen, or null if these lines are not an offer card. */
    static Offer parse(long now, List<OcrLine> input) {
        List<OcrLine> lines = new ArrayList<>(input);
        Collections.sort(lines, (a, b) -> a.top != b.top ? Integer.compare(a.top, b.top) : Integer.compare(a.left, b.left));

        // The two legs anchor everything else.
        int leg1 = -1;
        int leg2 = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (LEG.matcher(lines.get(i).text).find()) {
                if (leg1 < 0) leg1 = i;
                else {
                    leg2 = i;
                    break;
                }
            }
        }
        if (leg1 < 0 || leg2 < 0) return null;
        OcrLine l1 = lines.get(leg1);
        OcrLine l2 = lines.get(leg2);
        // Both legs share the card's left edge; this rejects stray matches elsewhere on screen.
        int lineH = Math.max(8, l1.height());
        if (Math.abs(l1.left - l2.left) > lineH * 2) return null;
        if (l2.top - l1.top > lineH * 14) return null;

        Offer o = new Offer();
        o.app = "uber";
        o.t = now;
        o.lastSeen = now;
        o.id = "uber-" + now;

        // Above the pickup leg: ride type, then the fare (the money line closest to the leg).
        boolean haveFare = false;
        boolean haveType = false;
        for (int i = leg1 - 1; i >= 0 && i >= leg1 - 8; i--) {
            String t = lines.get(i).text;
            Matcher m;
            if (!haveFare && (m = FARE.matcher(t)).find() && !t.contains("+") && !t.toLowerCase().contains("included")) {
                o.fare = num(m.group(1));
                haveFare = true;
            } else if (haveFare && !haveType && (m = TYPE.matcher(t)).find()) {
                o.rideType = m.group(1).trim().replaceAll("\\s+", " ");
                haveType = true;
            }
            if (t.contains("Exclusive") && !o.tags.contains("Exclusive")) o.tags.add("Exclusive");
        }
        if (!haveFare || o.fare < 1 || o.fare > 500) return null;

        fillLeg(o, l1.text, true);
        fillLeg(o, l2.text, false);
        if (o.tripMi > 300 || o.pickupMi > 100) return null;

        // Between the legs: pickup place, rider rating, stops.
        StringBuilder pickup = new StringBuilder();
        for (int i = leg1 + 1; i < leg2; i++) {
            String t = lines.get(i).text;
            Matcher m;
            if ((m = STOPS.matcher(t)).find()) {
                o.tags.add(m.group(1) + (m.group(1).equals("1") ? " stop" : " stops"));
            } else if ((m = RATING.matcher(t)).find() && t.length() <= 18) {
                o.riderRating = num(m.group(1));
            } else if (isPlace(t)) {
                append(pickup, t);
            }
        }
        o.pickup = pickup.toString();

        // Below the trip leg: destination, then the button.
        boolean button = false;
        StringBuilder dropoff = new StringBuilder();
        for (int i = leg2 + 1; i < lines.size() && i <= leg2 + 5; i++) {
            OcrLine l = lines.get(i);
            Matcher m = BUTTON.matcher(l.text);
            if (m.find()) {
                button = true;
                if (m.group(1).equalsIgnoreCase("Match")) o.tags.add("Trip Radar");
                break;
            }
            if (l.top - l2.top > lineH * 5) break;
            if (isPlace(l.text) && Math.abs(l.left - l2.left) <= lineH * 3) append(dropoff, l.text);
        }
        o.dropoff = dropoff.toString();

        if (!button && !haveType) return null;
        // Place names vary between recognitions, so identity uses the numbers only. The pickup
        // leg shrinks as the driver moves and is left out.
        o.key = o.fare + "|" + o.tripMin + "|" + o.tripMi;
        return o;
    }

    private static void fillLeg(Offer o, String text, boolean pickup) {
        Matcher m = LEG.matcher(text);
        if (!m.find()) return;
        int min = (m.group(1) == null ? 0 : Integer.parseInt(m.group(1)) * 60) + Integer.parseInt(m.group(2));
        double dist = num(m.group(3)) / (m.group(4).equalsIgnoreCase("ft") ? 5280.0 : 1.0);
        if (pickup) {
            o.pickupMin = min;
            o.pickupMi = dist;
        } else {
            o.tripMin = min;
            o.tripMi = dist;
        }
    }

    /** A line that reads like an address or place name rather than a badge or stray symbol. */
    private static boolean isPlace(String t) {
        if (t.length() < 4 || t.equalsIgnoreCase("Verified")) return false;
        int letters = 0;
        for (int i = 0; i < t.length(); i++) if (Character.isLetter(t.charAt(i))) letters++;
        return letters >= 4 && !t.toLowerCase().contains("included");
    }

    private static void append(StringBuilder b, String t) {
        if (b.length() > 0) b.append(' ');
        b.append(t);
    }

    private static double num(String s) {
        try {
            return Double.parseDouble(s.replace(',', '.'));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
