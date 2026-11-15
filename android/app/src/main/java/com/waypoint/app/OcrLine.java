package com.waypoint.app;

/** One line of text recognised in an image, with its position in pixels. Plain data. */
final class OcrLine {

    final String text;
    final int left;
    final int top;
    final int right;
    final int bottom;

    OcrLine(String text, int left, int top, int right, int bottom) {
        this.text = text == null ? "" : text.trim();
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    int height() {
        return bottom - top;
    }
}
