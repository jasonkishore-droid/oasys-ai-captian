package com.vasamo.print;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;

import java.util.List;

/** Draws a receipt onto a bitmap, used by the animation and the bill details screen. */
final class ReceiptRenderer {
    private static final int MAX_HEIGHT = 8000;

    private ReceiptRenderer() { }

    static Bitmap render(List<EscPos.Line> lines, int width, float dp) {
        float margin = 14 * dp;
        float inner = width - margin * 2;
        float tooth = 6 * dp;

        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setTypeface(Typeface.MONOSPACE);
        text.setTextSize(100);
        StringBuilder sample = new StringBuilder();
        for (int i = 0; i < EscPos.COLS; i++) sample.append('0');
        float size = 100 * inner / text.measureText(sample.toString());
        float lineHeight = size * 1.34f;

        float height = margin * 2 + tooth * 2;
        for (EscPos.Line l : lines) height += heightOf(l, inner, lineHeight);
        int h = (int) Math.min(height, MAX_HEIGHT);

        Bitmap out = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Path edge = new Path();
        edge.moveTo(0, tooth);
        for (float x = 0; x < width; x += tooth * 2) { // torn top
            edge.lineTo(x + tooth, 0);
            edge.lineTo(Math.min(x + tooth * 2, width), tooth);
        }
        edge.lineTo(width, h - tooth);
        for (float x = width; x > 0; x -= tooth * 2) { // torn bottom
            edge.lineTo(x - tooth, h);
            edge.lineTo(Math.max(x - tooth * 2, 0), h - tooth);
        }
        edge.close();
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(Color.WHITE);
        c.drawPath(edge, fill);

        text.setColor(Ui.INK);
        float y = margin + tooth;
        for (EscPos.Line l : lines) {
            float lh = heightOf(l, inner, lineHeight);
            if (l.image != null) {
                Bitmap image = bitmap(l.image);
                float scale = imageScale(l, inner);
                float w = image.getWidth() * scale;
                float left = margin + (l.align == 1 ? (inner - w) / 2 : l.align == 2 ? inner - w : 0);
                c.drawBitmap(image, new Rect(0, 0, image.getWidth(), image.getHeight()),
                        new RectF(left, y, left + w, y + image.getHeight() * scale), null); // unfiltered, so QR modules stay sharp
                image.recycle();
            } else {
                text.setTextSize(l.big ? size * 2 : size);
                text.setTypeface(Typeface.create(Typeface.MONOSPACE, l.bold ? Typeface.BOLD : Typeface.NORMAL));
                float w = text.measureText(l.text);
                float left = margin + (l.align == 1 ? (inner - w) / 2 : l.align == 2 ? inner - w : 0);
                c.drawText(l.text, left, y + lh * 0.78f, text);
            }
            y += lh;
        }
        return out;
    }

    private static Bitmap bitmap(EscPos.Raster r) {
        int width = Math.max(1, r.widthBytes * 8);
        int height = Math.max(1, r.height);
        int[] pixels = new int[width * height];
        for (int y = 0; y < r.height; y++) {
            for (int x = 0; x < r.widthBytes * 8; x++) {
                boolean on = (r.data[y * r.widthBytes + x / 8] & (0x80 >> (x % 8))) != 0;
                pixels[y * width + x] = on ? Color.BLACK : Color.TRANSPARENT;
            }
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888);
    }

    private static float imageScale(EscPos.Line l, float inner) {
        return inner * 0.7f / Math.max(1, l.image.widthBytes * 8);
    }

    private static float heightOf(EscPos.Line l, float inner, float lineHeight) {
        if (l.image != null) return l.image.height * imageScale(l, inner);
        return l.big ? lineHeight * 2 : lineHeight;
    }
}
