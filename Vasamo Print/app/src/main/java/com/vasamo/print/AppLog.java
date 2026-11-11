package com.vasamo.print;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;

/** Technical log for Diagnostics, kept in a small file. Never write guest details here. */
final class AppLog {
    private static final String TAG = "VasamoPrint";
    private static final int KEEP_ON_SCREEN = 100;
    private static final long MAX_FILE = 256 * 1024;
    private static final ArrayDeque<String> RECENT = new ArrayDeque<>();
    private static File file;

    private AppLog() { }

    static synchronized void init(Context context) {
        if (file == null) file = new File(context.getFilesDir(), "activity.log");
    }

    static synchronized void log(String line) {
        Log.i(TAG, line);
        String stamped = new SimpleDateFormat("dd MMM HH:mm:ss.SSS", Locale.US).format(new Date()) + "  " + line;
        RECENT.addFirst(stamped);
        while (RECENT.size() > KEEP_ON_SCREEN) RECENT.removeLast();
        if (file == null) return;
        try {
            if (file.length() > MAX_FILE) {
                File old = new File(file.getParent(), "activity.old.log");
                old.delete();
                file.renameTo(old);
            }
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write((stamped + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException e) {
            Log.w(TAG, "Could not write the log file", e);
        }
    }

    static synchronized String recent() {
        StringBuilder out = new StringBuilder();
        for (String line : RECENT) out.append(line).append('\n');
        return out.toString().trim();
    }

    static synchronized byte[] export() throws IOException {
        return file != null && file.exists() ? Files.readAllBytes(file.toPath()) : new byte[0];
    }
}
