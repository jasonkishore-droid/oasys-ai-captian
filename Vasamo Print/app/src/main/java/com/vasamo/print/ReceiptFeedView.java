package com.vasamo.print;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.TimeInterpolator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

import java.util.List;

/**
 * A flat drawing of a POS printer feeding the receipt out line by line, then showing it whole.
 * The paper rises header first with the text upright, the way a thermal printer really feeds.
 *
 * It follows the real printer: the paper starts moving when the printer reports it started, moves
 * at the printer's learned speed, waits near the end if the printer is slower, and finishes when
 * the printer reports it is done.
 */
final class ReceiptFeedView extends View {
    private static final float HOLD_AT = 0.97f;      // how far the paper goes before waiting for the printer
    private static final long CATCH_UP_MS = 250;     // finishing the last stretch once the printer is done
    private static final long START_FALLBACK_MS = 2500; // start anyway if the printer never says it started
    private static final long DONE_FALLBACK_MS = 20000; // and finish anyway if it never says it is done
    private static final long HOLD_MS = 2600;

    private final float dp = getResources().getDisplayMetrics().density;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bitmapPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final RectF rect = new RectF();

    private Bitmap paper;
    private int lineCount;
    private int seq;
    private long expectedMs;
    private long shownAt;    // first frame on screen
    private long startAt;    // the paper started moving
    private long doneAt;     // the printer finished
    private float feedAtDone;
    private boolean feeding;
    private float feed;      // 0..1, how much paper is out
    private float tear;      // 0..1, the printer dropping away and the paper centring
    private ValueAnimator running;
    private Runnable onDone;

    ReceiptFeedView(Context context) {
        super(context);
        setOnClickListener(v -> finish());
    }

    boolean isPlaying() {
        return getVisibility() == VISIBLE;
    }

    void play(List<EscPos.Line> lines, int seq, long expectedMs, Runnable done) {
        this.seq = seq;
        this.expectedMs = Math.max(800, expectedMs);
        onDone = done;
        lineCount = Math.max(1, lines.size());
        setAlpha(1f);
        setVisibility(VISIBLE);
        setKeepScreenOn(true);
        feed = 0;
        tear = 0;
        shownAt = startAt = doneAt = 0;
        feeding = false;
        if (getWidth() == 0) post(() -> { if (isPlaying()) start(lines); }); // not laid out yet
        else start(lines);
    }

    /** The job failed: stop pretending it is printing. */
    void cancel() {
        finish();
    }

    private void start(List<EscPos.Line> lines) {
        paper = ReceiptRenderer.render(lines, Math.round(getWidth() * 0.80f), dp);
        feeding = true;
        invalidate();
    }

    /** Works out where the paper is for this frame, from the printer's signals and the clock. */
    private void updateFeed() {
        long now = SystemClock.uptimeMillis();
        if (shownAt == 0) {
            if (!actuallyVisible()) return; // e.g. the screen is still waking up
            shownAt = now;
            PrintService.readySeq = seq; // the service sends the job to the printer now
            AppLog.log("Animation on screen");
        }
        if (startAt == 0) {
            if (PrintService.startedSeq >= seq) {
                startAt = Math.min(now, PrintService.startedAt); // if the printer started first, catch up to it
            } else if (PrintService.doneSeq >= seq || now - shownAt > START_FALLBACK_MS) {
                startAt = now;
            }
            if (startAt != 0) AppLog.log("Animation paper moving (expected " + expectedMs + " ms)");
        }
        if (startAt == 0) return; // the printer has not started: the paper waits in the slot
        boolean printerStopped = PrintService.stoppedSeq >= seq || PrintService.doneSeq >= seq;
        if (doneAt == 0 && (printerStopped || now - startAt > DONE_FALLBACK_MS)) {
            doneAt = now;
            feedAtDone = feed;
            AppLog.log("Animation finishing, " + Math.round(feed * 100) + "% fed");
        }
        if (doneAt == 0) {
            feed = Math.min(HOLD_AT, (now - startAt) / (float) expectedMs);
        } else {
            feed = feedAtDone + (1 - feedAtDone) * Math.min(1f, (now - doneAt) / (float) CATCH_UP_MS);
            if (feed >= 1f) {
                feed = 1f;
                feeding = false;
                tearOff();
            }
        }
    }

    /** True only when a person can really see this view: screen on and our window in front. */
    private boolean actuallyVisible() {
        android.os.PowerManager power = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return isShown() && hasWindowFocus() && power.isInteractive();
    }

    private void tearOff() {
        animate(0, 1, 500, new DecelerateInterpolator(), a -> tear = (float) a.getAnimatedValue(), () -> postDelayed(fadeOut, HOLD_MS));
    }

    private final Runnable fadeOut = () ->
            animate(1, 0, 300, new DecelerateInterpolator(), a -> setAlpha((float) a.getAnimatedValue()), this::finish);

    private void finish() {
        stopAnimation();
        feeding = false;
        setVisibility(GONE);
        setKeepScreenOn(false);
        if (paper != null) { paper.recycle(); paper = null; }
        Runnable done = onDone;
        onDone = null;
        if (done != null) done.run();
    }

    private void stopAnimation() {
        removeCallbacks(fadeOut);
        if (running != null) { running.removeAllListeners(); running.cancel(); running = null; }
    }

    @Override protected void onDetachedFromWindow() {
        stopAnimation();
        super.onDetachedFromWindow();
    }

    private void animate(float from, float to, long ms, TimeInterpolator how, ValueAnimator.AnimatorUpdateListener each, Runnable then) {
        ValueAnimator a = ValueAnimator.ofFloat(from, to);
        a.setDuration(ms);
        a.setInterpolator(how);
        a.addUpdateListener(v -> { each.onAnimationUpdate(v); invalidate(); });
        a.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) { then.run(); }
        });
        running = a;
        a.start();
    }

    @Override protected void onDraw(Canvas canvas) {
        int w = getWidth();
        int h = getHeight();
        canvas.drawColor(Ui.CREAM_DARK);
        if (paper == null) return;
        if (feeding) {
            updateFeed();
            postInvalidateOnAnimation();
        }

        float bodyHeight = h * 0.2f;
        float slotY = h - bodyHeight + tear * (bodyHeight + 24 * dp);
        float paperLeft = (w - paper.getWidth()) / 2f;

        if (tear <= 0) {
            canvas.save();
            canvas.clipRect(0, 0, w, slotY);
            canvas.drawBitmap(paper, paperLeft, slotY - fedPixels(), bitmapPaint);
            canvas.restore();
        }
        drawPrinter(canvas, w, h, slotY);
        if (tear > 0) drawLoose(canvas, w, h);
    }

    /** Moves in short steps with a pause between them, like a stepper motor. */
    private float fedPixels() {
        float steps = lineCount * 2f;
        float position = feed * steps;
        float whole = (float) Math.floor(position);
        float part = position - whole;
        float eased = part < 0.6f ? part / 0.6f : 1f;
        return Math.min(1f, (whole + eased) / steps) * paper.getHeight();
    }

    private void drawLoose(Canvas canvas, int w, int h) {
        float pad = 24 * dp;
        float target = Math.min(1f, (h - pad * 2) / paper.getHeight());
        float scale = 1 + (target - 1) * tear;
        float startCentre = h * 0.8f - paper.getHeight() / 2f;
        float centre = startCentre + (h / 2f - startCentre) * tear;
        canvas.save();
        canvas.translate(w / 2f, centre);
        canvas.scale(scale, scale);
        canvas.drawBitmap(paper, -paper.getWidth() / 2f, -paper.getHeight() / 2f, bitmapPaint);
        canvas.restore();
    }

    private void drawPrinter(Canvas canvas, int w, int h, float slotY) {
        float side = w * 0.05f;
        float corner = 16 * dp;
        paint.setColor(Ui.MAROON);
        rect.set(side, slotY - 12 * dp, w - side, h + corner + slotY);
        canvas.drawRoundRect(rect, corner, corner, paint);

        paint.setColor(Ui.MAROON_DARK); // the slot
        rect.set(w * 0.08f, slotY - 3 * dp, w * 0.92f, slotY + 7 * dp);
        canvas.drawRect(rect, paint);

        paint.setColor(0xFFFFFFFF);
        paint.setTextSize(22 * dp);
        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        canvas.drawText("OASYS RESTAURANT", side + 24 * dp, slotY + 54 * dp, paint);
        paint.setTextSize(14 * dp);
        paint.setTypeface(Typeface.DEFAULT);
        canvas.drawText(feed < 1f ? "Printing your bill..." : "Printed", side + 24 * dp, slotY + 78 * dp, paint);
    }
}
