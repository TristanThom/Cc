package com.waypoint.app;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Follows an Uber offer from the card (read from a screenshot) to its outcome.
 *
 * Uber does not report taps on Accept or the X, so the outcome comes from Uber's readable
 * screens afterwards: a pickup that was not there before the card means accepted; no new
 * pickup within the resolve window means declined (a timeout counts as declined).
 *
 * Pure Java so it can be unit-tested off-device.
 */
final class UberOfferTracker {

    static final long RESOLVE_WINDOW_MS = 30_000;
    /** Uber's screen collapses to a handful of elements while a card is up; ignore those. */
    static final int FULL_SCREEN_MIN_NODES = 9;

    private Offer open;
    private Set<String> pickupsBefore = new HashSet<>();
    private Set<String> lastPickups = new HashSet<>();

    boolean hasOpen() {
        return open != null;
    }

    /** True if this card is the offer already being tracked. */
    boolean isOpen(Offer card) {
        return open != null && open.key.equals(card.key);
    }

    /** A card was read from the screen. Returns an earlier offer it displaced, if any. */
    List<Offer> onCard(long now, Offer card) {
        List<Offer> done = new ArrayList<>();
        if (isOpen(card)) {
            open.lastSeen = now;
            // Later reads can fill in text an earlier, blurrier read missed.
            if (open.pickup.isEmpty()) open.pickup = card.pickup;
            if (open.dropoff.isEmpty()) open.dropoff = card.dropoff;
            return done;
        }
        if (open != null) done.add(finish(open, Offer.DECLINED, now));
        open = card;
        pickupsBefore = new HashSet<>(lastPickups);
        return done;
    }

    /** One of Uber's readable screens. Returns the offer it resolved, if any. */
    List<Offer> onScreen(long now, List<OfferNode> nodes) {
        List<Offer> done = new ArrayList<>();
        Set<String> pickups = new HashSet<>();
        for (OfferNode n : nodes) {
            String l = n.label();
            if (l.startsWith("Picking up ")) pickups.add(l);
            else if (l.equals("Pickup")) pickups.add("Pickup"); // a ride queued behind the current one
        }
        if (open != null) {
            boolean newPickup = false;
            for (String p : pickups) if (!pickupsBefore.contains(p)) newPickup = true;
            if (newPickup) {
                done.add(finish(open, Offer.ACCEPTED, now));
                open = null;
            } else if (now - open.lastSeen > RESOLVE_WINDOW_MS) {
                done.add(finish(open, Offer.DECLINED, now));
                open = null;
            }
        }
        if (nodes.size() >= FULL_SCREEN_MIN_NODES) lastPickups = pickups;
        return done;
    }

    /** Call when time passes without an Uber screen, so a vanished offer still gets closed. */
    List<Offer> tick(long now) {
        List<Offer> done = new ArrayList<>();
        if (open != null && now - open.lastSeen > RESOLVE_WINDOW_MS) {
            done.add(finish(open, Offer.DECLINED, now));
            open = null;
        }
        return done;
    }

    private static Offer finish(Offer o, String outcome, long now) {
        o.outcome = outcome;
        o.resolvedAt = now;
        return o;
    }
}
