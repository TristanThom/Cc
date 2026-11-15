package com.waypoint.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

/**
 * Lines here follow the layout of real Uber Driver offer cards as text recognition returns
 * them (positions in pixels), with made-up places.
 */
public class UberOfferTest {

    private static OcrLine at(String text, int left, int top) {
        return new OcrLine(text, left, top, left + text.length() * 14, top + 28);
    }

    /** A Trip Radar card over the map, with unrelated text around it. */
    private static List<OcrLine> radarCard() {
        return new ArrayList<>(Arrays.asList(
            at("$58.38", 230, 20), // today's earnings pill
            at("WESTSIDE", 270, 60),
            at("Cougar Mall,", 380, 275),
            at("UberX", 64, 404),
            at("$6.69", 34, 450),
            at("5% Pro Perk included", 64, 496),
            at("9 min • 1.7 mi", 68, 555),
            at("First St & Transit Mall, Springfield", 68, 584),
            at("★ 4.95", 80, 618),
            at("8 mins • 1.6 mi", 68, 668),
            at("Oak St & Pine Ct, Springfield", 68, 697),
            at("Match", 238, 755)
        ));
    }

    private static List<OcrLine> exclusiveCard() {
        return new ArrayList<>(Arrays.asList(
            at("King St", 60, 20),
            at("900 ft", 20, 40),
            at("UberX", 64, 404),
            at("Exclusive", 146, 404),
            at("$16.08 ©", 34, 450),
            at("5% Pro Perk included", 64, 496),
            at("7 min · 3.5 mi", 68, 555),
            at("Harbor Pointe Dr & Darby Blvd,", 68, 584),
            at("Mount Pleasant", 68, 612),
            at("* 4.97", 80, 646),
            at("Verified", 170, 646),
            at("1 stop", 68, 690),
            at("14 mins 5.2 mi", 68, 730),
            at("Fulton St & King St, Springfield", 68, 759),
            at("Accept", 234, 815)
        ));
    }

    @Test
    public void readsATripRadarCard() {
        Offer o = UberOfferParser.parse(1000, radarCard());
        assertNotNull(o);
        assertEquals("uber", o.app);
        assertEquals(6.69, o.fare, 1e-9);
        assertEquals("UberX", o.rideType);
        assertEquals(9, o.pickupMin);
        assertEquals(1.7, o.pickupMi, 1e-9);
        assertEquals(8, o.tripMin);
        assertEquals(1.6, o.tripMi, 1e-9);
        assertEquals("First St & Transit Mall, Springfield", o.pickup);
        assertEquals("Oak St & Pine Ct, Springfield", o.dropoff);
        assertEquals(4.95, o.riderRating, 1e-9);
        assertEquals(Collections.singletonList("Trip Radar"), o.tags);
    }

    @Test
    public void readsAnExclusiveCardDespiteMessyRecognition() {
        // Bullets read as "·" or dropped, an icon read as "©", a two-line address, a stop.
        Offer o = UberOfferParser.parse(1000, exclusiveCard());
        assertNotNull(o);
        assertEquals(16.08, o.fare, 1e-9);
        assertEquals(7, o.pickupMin);
        assertEquals(3.5, o.pickupMi, 1e-9);
        assertEquals(14, o.tripMin);
        assertEquals(5.2, o.tripMi, 1e-9);
        assertEquals("Harbor Pointe Dr & Darby Blvd, Mount Pleasant", o.pickup);
        assertEquals("Fulton St & King St, Springfield", o.dropoff);
        assertEquals(4.97, o.riderRating, 1e-9);
        assertTrue(o.tags.contains("Exclusive"));
        assertTrue(o.tags.contains("1 stop"));
    }

    @Test
    public void orderOfLinesDoesNotMatter() {
        List<OcrLine> shuffled = radarCard();
        Collections.reverse(shuffled);
        assertEquals(6.69, UberOfferParser.parse(1000, shuffled).fare, 1e-9);
    }

    @Test
    public void priorityCardIgnoresTheSurchargeLine() {
        List<OcrLine> card = new ArrayList<>(Arrays.asList(
            at("UberX Priority", 64, 404),
            at("Exclusive", 250, 404),
            at("$10.08", 34, 450),
            at("5% Pro Perk included", 64, 496),
            at("+$1.29 included for priority pickup", 64, 540),
            at("5 min • 1.1 mi", 68, 600),
            at("Jackson St & Meeting St, Springfield", 68, 629),
            at("8 mins • 1.3 mi", 68, 713),
            at("Burns Ln & Meeting St, Springfield", 68, 742)
        ));
        // No button text: the card is showing its spinner after a tap.
        Offer o = UberOfferParser.parse(1000, card);
        assertNotNull(o);
        assertEquals(10.08, o.fare, 1e-9);
        assertEquals("UberX Priority", o.rideType);
    }

    @Test
    public void otherUberScreensAreNotOffers() {
        // Home screen: a planner tile with a time and distance, earnings, no card.
        assertNull(UberOfferParser.parse(1000, Arrays.asList(at("$58.38", 230, 20), at("Trip Planner", 40, 300), at("3 min", 40, 340), at("0.9 mi", 140, 340), at("You're online", 300, 700))));
        // Navigation: one leg-like line only.
        assertNull(UberOfferParser.parse(1000, Arrays.asList(at("King St", 60, 20), at("8 min • 1.7 mi", 300, 700), at("Picking up Sam", 300, 740))));
        // Two legs but no fare above them.
        assertNull(UberOfferParser.parse(1000, Arrays.asList(at("UberX", 64, 404), at("9 min • 1.7 mi", 68, 555), at("8 mins • 1.6 mi", 68, 668), at("Match", 238, 755))));
        // Legs far apart horizontally are two unrelated things.
        assertNull(UberOfferParser.parse(1000, Arrays.asList(at("UberX", 64, 404), at("$6.69", 34, 450), at("9 min • 1.7 mi", 68, 555), at("8 mins • 1.6 mi", 700, 668), at("Match", 238, 755))));
        assertNull(UberOfferParser.parse(1000, new ArrayList<OcrLine>()));
    }

    private static List<OfferNode> screen(int filler, String... texts) {
        List<OfferNode> n = new ArrayList<>();
        for (String t : texts) n.add(new OfferNode(t, "", ""));
        for (int i = 0; i < filler; i++) n.add(new OfferNode("chrome " + i, "", ""));
        return n;
    }

    @Test
    public void acceptedWhenANewPickupAppears() {
        UberOfferTracker t = new UberOfferTracker();
        t.onScreen(0, screen(12, "You're online"));
        assertTrue(t.onCard(1000, UberOfferParser.parse(1000, radarCard())).isEmpty());
        // Re-reading the same card (pickup leg shorter) is still the same offer.
        List<OcrLine> again = radarCard();
        again.set(6, at("8 min • 1.5 mi", 68, 555));
        assertTrue(t.onCard(3000, UberOfferParser.parse(3000, again)).isEmpty());
        // The collapsed screen under the card says nothing either way.
        assertTrue(t.onScreen(4000, screen(0, "0.5 mi", "King St")).isEmpty());
        List<Offer> done = t.onScreen(9000, screen(12, "Picking up Sam", "Navigate"));
        assertEquals(1, done.size());
        assertEquals(Offer.ACCEPTED, done.get(0).outcome);
        assertEquals(1000, done.get(0).t);
    }

    @Test
    public void midTripOfferIsAcceptedOnlyByAQueuedPickup() {
        UberOfferTracker t = new UberOfferTracker();
        t.onScreen(0, screen(12, "Dropping off Alex"));
        t.onCard(1000, UberOfferParser.parse(1000, exclusiveCard()));
        assertTrue(t.onScreen(5000, screen(12, "Dropping off Alex")).isEmpty());
        assertEquals(Offer.ACCEPTED, t.onScreen(8000, screen(12, "Dropping off Alex", "Pickup", "Sam")).get(0).outcome);
    }

    @Test
    public void anExistingPickupIsNotMistakenForAcceptance() {
        UberOfferTracker t = new UberOfferTracker();
        t.onScreen(0, screen(12, "Picking up Alex"));
        t.onCard(1000, UberOfferParser.parse(1000, radarCard()));
        assertTrue(t.onScreen(5000, screen(12, "Picking up Alex")).isEmpty());
        List<Offer> done = t.onScreen(1000 + UberOfferTracker.RESOLVE_WINDOW_MS + 1, screen(12, "Picking up Alex"));
        assertEquals(Offer.DECLINED, done.get(0).outcome);
    }

    @Test
    public void noPickupMeansDeclinedAndANewCardClosesTheOldOne() {
        UberOfferTracker t = new UberOfferTracker();
        t.onCard(1000, UberOfferParser.parse(1000, radarCard()));
        List<Offer> done = t.onCard(9000, UberOfferParser.parse(9000, exclusiveCard()));
        assertEquals(1, done.size());
        assertEquals(6.69, done.get(0).fare, 1e-9);
        assertEquals(Offer.DECLINED, done.get(0).outcome);
        assertTrue(t.tick(9000 + 1000).isEmpty());
        assertEquals(Offer.DECLINED, t.tick(9000 + UberOfferTracker.RESOLVE_WINDOW_MS + 1).get(0).outcome);
        assertTrue(!t.hasOpen());
    }
}
