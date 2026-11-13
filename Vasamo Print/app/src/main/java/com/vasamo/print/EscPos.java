package com.vasamo.print;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Reads an ESC/POS job back into lines for the screen, and builds or changes jobs. No Android code here. */
final class EscPos {
    static final int COLS = 32;
    static final String DUPLICATE_MARK = "** DUPLICATE COPY **";

    private EscPos() { }

    static final class Raster {
        final int widthBytes;
        final int height;
        final byte[] data;

        Raster(int widthBytes, int height, byte[] data) {
            this.widthBytes = widthBytes;
            this.height = height;
            this.data = data;
        }
    }

    static final class Line {
        final String text;
        final int align; // 0 left, 1 centre, 2 right
        final boolean bold;
        final boolean big;
        final Raster image;

        Line(String text, int align, boolean bold, boolean big, Raster image) {
            this.text = text;
            this.align = align;
            this.bold = bold;
            this.big = big;
            this.image = image;
        }
    }

    static List<Line> parse(byte[] b) {
        List<Line> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        int align = 0;
        boolean bold = false;
        boolean big = false;
        int i = 0;
        while (i < b.length) {
            int c = b[i] & 0xff;
            int cmd = i + 1 < b.length ? b[i + 1] & 0xff : 0;
            int arg = i + 2 < b.length ? b[i + 2] & 0xff : 0;
            if (c == 0x1b) { // ESC
                if (cmd == '@') { align = 0; bold = false; big = false; i += 2; continue; }
                if (cmd == 'a') align = arg;
                else if (cmd == 'E') bold = arg != 0;
                i += 3;
            } else if (c == 0x1d) { // GS
                if (cmd == 'v' && i + 7 < b.length) { // GS v 0 m xL xH yL yH, then the pixels
                    int widthBytes = (b[i + 4] & 0xff) | (b[i + 5] & 0xff) << 8;
                    int height = (b[i + 6] & 0xff) | (b[i + 7] & 0xff) << 8;
                    int end = i + 8 + widthBytes * height;
                    if (end > b.length) break; // truncated image: show what came before it
                    out.add(new Line("", align, false, false, new Raster(widthBytes, height, Arrays.copyOfRange(b, i + 8, end))));
                    i = end;
                } else if (cmd == '(' && i + 4 < b.length) { // GS ( k pL pH, then the data
                    i += 5 + ((b[i + 3] & 0xff) | (b[i + 4] & 0xff) << 8);
                } else {
                    if (cmd == '!') big = arg != 0;
                    i += 3;
                }
            } else {
                if (c == 0x0a) {
                    out.add(new Line(cur.toString(), align, bold, big, null));
                    cur.setLength(0);
                } else if (c >= 0x20 && c < 0x7f) {
                    cur.append((char) c);
                }
                i++;
            }
        }
        if (cur.length() > 0) out.add(new Line(cur.toString(), align, bold, big, null));
        while (!out.isEmpty() && out.get(out.size() - 1).image == null && out.get(out.size() - 1).text.trim().isEmpty()) {
            out.remove(out.size() - 1);
        }
        return out;
    }

    /** How much paper the job uses, in normal text lines (a large line counts twice, an image by its height). */
    static float paperLines(List<Line> lines) {
        float total = 0;
        for (Line l : lines) {
            if (l.image != null) total += l.image.height / 30f; // one text line is about 30 dots tall
            else total += l.big ? 2 : 1;
        }
        return Math.max(1, total);
    }

    /** The same job with a bold, centred DUPLICATE COPY line at the very top. */
    static byte[] markDuplicate(byte[] job) {
        ByteArrayOutputStream p = new ByteArrayOutputStream(job.length + 40);
        boolean startsWithInit = job.length >= 2 && job[0] == 0x1b && job[1] == '@';
        put(p, 0x1b, '@', 0x1b, 'a', 1, 0x1b, 'E', 1);
        text(p, DUPLICATE_MARK + "\n");
        put(p, 0x1b, 'E', 0, 0x1b, 'a', 0);
        int start = startsWithInit ? 2 : 0;
        p.write(job, start, job.length - start);
        return p.toByteArray();
    }

    static byte[] testPage(String when) {
        ByteArrayOutputStream p = new ByteArrayOutputStream();
        put(p, 0x1b, '@', 0x1b, 'a', 1, 0x1b, 'E', 1);
        text(p, "VASAMO PRINT\n");
        put(p, 0x1b, 'E', 0);
        text(p, "Printer connected\n" + when + "\n");
        put(p, 0x1b, 'a', 0);
        text(p, "--------------------------------\n01234567890123456789012345678901\n");
        put(p, 0x1b, 'a', 1);
        text(p, "Test page OK\n");
        put(p, 0x1b, 'd', 4);
        return p.toByteArray();
    }

    private static void put(ByteArrayOutputStream p, int... bytes) {
        for (int x : bytes) p.write(x);
    }

    private static void text(ByteArrayOutputStream p, String s) {
        byte[] bytes = s.getBytes(StandardCharsets.US_ASCII);
        p.write(bytes, 0, bytes.length);
    }
}
