package com.waypoint.app;

import java.util.ArrayList;
import java.util.List;

/** One ride offer shown by a driver app, and what happened to it. No rider names are kept. */
final class Offer {

    static final String ACCEPTED = "accepted";
    static final String DECLINED = "declined";
    static final String MISSED = "missed";

    String id = "";
    String app = "";
    /** When the offer card first appeared, epoch ms. */
    long t;
    long resolvedAt;
    double fare;
    double bonus;
    /** The app's own estimated hourly rate for the ride, 0 if not shown. */
    double hourly;
    int pickupMin;
    double pickupMi;
    int tripMin;
    double tripMi;
    String pickup = "";
    String dropoff = "";
    String rideType = "";
    double riderRating;
    /** True when offered while already on a ride ("Add to queue"). */
    boolean queued;
    final List<String> tags = new ArrayList<>();
    String outcome = "";

    // Tracking state, not persisted.
    String key = "";
    long lastSeen;
    /** The card was mid-animation: fare visible but route missing. */
    boolean partial;
}
