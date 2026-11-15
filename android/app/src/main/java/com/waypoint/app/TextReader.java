package com.waypoint.app;

import android.graphics.Bitmap;
import android.graphics.Rect;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * On-device text recognition (Google ML Kit, model bundled in the app). Images are processed
 * on the phone and never uploaded.
 */
final class TextReader {

    interface Callback {
        void onLines(List<OcrLine> lines);

        void onError(Exception e);
    }

    private static TextRecognizer client;

    private TextReader() {}

    private static synchronized TextRecognizer client() {
        if (client == null) client = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        return client;
    }

    /** Recognises text in `bitmap`. Callbacks run on `executor`, or the main thread if null. */
    static void read(Bitmap bitmap, Executor executor, final Callback cb) {
        try {
            Task<Text> task = client().process(InputImage.fromBitmap(bitmap, 0));
            if (executor != null) {
                task.addOnSuccessListener(executor, text -> cb.onLines(lines(text))).addOnFailureListener(executor, cb::onError);
            } else {
                task.addOnSuccessListener(text -> cb.onLines(lines(text))).addOnFailureListener(cb::onError);
            }
        } catch (Exception e) {
            cb.onError(e);
        }
    }

    private static List<OcrLine> lines(Text text) {
        List<OcrLine> out = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect r = line.getBoundingBox();
                if (r == null) continue;
                out.add(new OcrLine(line.getText(), r.left, r.top, r.right, r.bottom));
            }
        }
        return out;
    }
}
