package com.waypoint.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/** Screens here are synthetic but follow the structure of real Lyft Driver offer cards. */
public class LyftOfferTrackerTest {

    private static OfferNode text(String t) {
        return new OfferNode(t, "", "");
    }

    private static OfferNode id(String id) {
        return new OfferNode("", "", "com.lyft.android.driver:id/" + id);
    }

    private static OfferNode stop(String t) {
        return new OfferNode(t, "", "com.lyft.android.driver:id/stop_row_content");
    }

    private static List<OfferNode> card(String fare, boolean queued, String pickupLeg) {
        List<OfferNode> n = new ArrayList<>();
        n.add(text("Maneuver icon"));
        n.add(id("reject_ride_button"));
        n.add(new OfferNode("", "Reject ride", ""));
        if (queued) n.add(text("Add to queue"));
        n.add(text(fare));
        n.add(text("Incl. $1.50 bonus"));
        n.add(text("$30.00/hr est. rate for this ride"));
        n.add(text(pickupLeg));
        n.add(stop("First & Main, Springfield"));
        n.add(text("12 min • 3.4 mi"));
        n.add(stop("Oak & Pine, Springfield"));
        n.add(text("Priority Mode ride"));
        n.add(text("Sam"));
        n.add(text("Verified"));
        n.add(text("4.9"));
        n.add(text("Lyft"));
        n.add(id("primary_button"));
        n.add(text(queued ? "Add" : "Accept"));
        return n;
    }

    private static List<OfferNode> screen(String... texts) {
        List<OfferNode> n = new ArrayList<>();
        for (String t : texts) n.add(text(t));
        return n;
    }

    @Test
    public void parsesCardFields() {
        Offer o = LyftOfferTracker.parse(1000, card("$8.25", false, "4 min • 0.6 mi"));
        assertEquals(8.25, o.fare, 1e-9);
        assertEquals(1.5, o.bonus, 1e-9);
        assertEquals(30.0, o.hourly, 1e-9);
        assertEquals(4, o.pickupMin);
        assertEquals(0.6, o.pickupMi, 1e-9);
        assertEquals(12, o.tripMin);
        assertEquals(3.4, o.tripMi, 1e-9);
        assertEquals("First & Main, Springfield", o.pickup);
        assertEquals("Oak & Pine, Springfield", o.dropoff);
        assertEquals("Lyft", o.rideType);
        assertEquals(4.9, o.riderRating, 1e-9);
        assertEquals(Arrays.asList("Priority Mode ride"), o.tags);
        assertFalse(o.queued);
        assertFalse(o.partial);
    }

    @Test
    public void feetAndHoursAreConverted() {
        Offer o = LyftOfferTracker.parse(1000, card("$40", false, "1 hr 5 min • 528 ft"));
        assertEquals(65, o.pickupMin);
        assertEquals(0.1, o.pickupMi, 1e-9);
        assertEquals(40.0, o.fare, 1e-9);
    }

    @Test
    public void acceptedWhenPickupScreenFollows() {
        LyftOfferTracker t = new LyftOfferTracker();
        assertTrue(t.onScreen(1000, card("$8.25", false, "4 min • 0.6 mi")).isEmpty());
        assertTrue(t.cardVisible());
        // The pickup leg ticking down must not start a second offer.
        assertTrue(t.onScreen(3000, card("$8.25", false, "3 min • 0.5 mi")).isEmpty());
        List<Offer> done = t.onScreen(6000, screen("3 min • 0.5 mi", "Pick up Sam", "Arrive"));
        assertEquals(1, done.size());
        assertEquals(Offer.ACCEPTED, done.get(0).outcome);
        assertEquals(1000, done.get(0).t);
        assertFalse(t.cardVisible());
    }

    @Test
    public void queuedOfferIgnoresTheRideAlreadyUnderway() {
        LyftOfferTracker t = new LyftOfferTracker();
        t.onScreen(1000, card("$8.25", true, "4 min • 0.6 mi"));
        // Still heading to the current rider: not an acceptance of the queued offer.
        assertTrue(t.onScreen(4000, screen("Pick up Alex", "Arrive")).isEmpty());
        List<Offer> done = t.onScreen(5000, screen("Ride added to queue", "Pick up Alex"));
        assertEquals(Offer.ACCEPTED, done.get(0).outcome);
        assertTrue(done.get(0).queued);
    }

    @Test
    public void declinedAndMissed() {
        LyftOfferTracker t = new LyftOfferTracker();
        t.onScreen(1000, card("$8.25", true, "4 min • 0.6 mi"));
        assertEquals(Offer.DECLINED, t.onScreen(4000, screen("You declined the ride")).get(0).outcome);

        t.onScreen(10_000, card("$9.00", false, "4 min • 0.6 mi"));
        assertTrue(t.onScreen(20_000, screen("Go Online")).isEmpty());
        assertEquals(Offer.MISSED, t.tick(10_000 + LyftOfferTracker.RESOLVE_WINDOW_MS + 1).get(0).outcome);
    }

    @Test
    public void partialCardExtendsButNeverStartsAnOffer() {
        List<OfferNode> partial = Arrays.asList(id("reject_ride_button"), text("$8.25"), text("Sam"), id("primary_button"), text("Add"));
        LyftOfferTracker t = new LyftOfferTracker();
        assertTrue(t.onScreen(500, partial).isEmpty());
        assertTrue(t.tick(500 + 60_000).isEmpty());

        t.onScreen(1000, card("$8.25", true, "4 min • 0.6 mi"));
        assertTrue(t.onScreen(5000, partial).isEmpty());
        List<Offer> done = t.onScreen(6000, screen("Ride added to queue"));
        assertEquals(1, done.size());
        assertEquals("First & Main, Springfield", done.get(0).pickup);
    }

    @Test
    public void aDifferentOfferClosesThePreviousOneAsMissed() {
        LyftOfferTracker t = new LyftOfferTracker();
        t.onScreen(1000, card("$8.25", false, "4 min • 0.6 mi"));
        List<Offer> done = t.onScreen(9000, card("$11.00", false, "4 min • 0.6 mi"));
        assertEquals(1, done.size());
        assertEquals(8.25, done.get(0).fare, 1e-9);
        assertEquals(Offer.MISSED, done.get(0).outcome);
    }
}
