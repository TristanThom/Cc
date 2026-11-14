package com.waypoint.app;

/** The parts of an on-screen element the offer parsers need. Plain data, no Android types. */
final class OfferNode {

    final String text;
    final String desc;
    final String id;

    OfferNode(String text, String desc, String id) {
        this.text = text == null ? "" : text;
        this.desc = desc == null ? "" : desc;
        this.id = id == null ? "" : id;
    }

    String label() {
        return text.isEmpty() ? desc : text;
    }
}
