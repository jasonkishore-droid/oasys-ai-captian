package com.vasamo.print;

import android.content.Context;
import android.content.SharedPreferences;

/** The choices on the Settings tab. */
final class Prefs {
    private final SharedPreferences p;

    Prefs(Context context) {
        p = context.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    boolean animation() { return p.getBoolean("animation", true); }
    void animation(boolean on) { p.edit().putBoolean("animation", on).apply(); }

    boolean wakeScreen() { return p.getBoolean("wake", true); }
    void wakeScreen(boolean on) { p.edit().putBoolean("wake", on).apply(); }

    int retentionDays() { return p.getInt("retention", 30); }
    void retentionDays(int days) { p.edit().putInt("retention", days).apply(); }

    /**
     * How long the paper moves for a job: a fixed start-up time plus a time per line, the per-line part
     * learned from real prints. Measured on the P10: about 380 ms + 69 ms per line.
     */
    static final long PRINT_STARTUP_MS = 380;

    float msPerLine() { return p.getFloat("ms_per_line_v2", 69f); }

    long expectedPrintMs(float lines) {
        return PRINT_STARTUP_MS + Math.round(lines * msPerLine());
    }

    void learnPrintSpeed(long durationMs, float lines) {
        float measured = (durationMs - PRINT_STARTUP_MS) / lines;
        if (measured < 20 || measured > 600) return; // not a believable reading
        p.edit().putFloat("ms_per_line_v2", msPerLine() * 0.6f + measured * 0.4f).apply();
    }

    boolean setupDone() { return p.getBoolean("setup", false); }
    void setupDone(boolean done) { p.edit().putBoolean("setup", done).apply(); }
}
