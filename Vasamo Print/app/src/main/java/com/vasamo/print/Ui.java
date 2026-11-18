package com.vasamo.print;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

/** The app's flat design: colours, text styles and building blocks. */
final class Ui {
    static final int MAROON = 0xFF8E2A1E;
    static final int MAROON_DARK = 0xFF6E1F15;
    static final int CREAM = 0xFFFBF6EC;
    static final int CREAM_DARK = 0xFFF1E8D8;
    static final int LINE = 0xFFE5DBC9;
    static final int INK = 0xFF2B211B;
    static final int MUTED = 0xFF6F6256;
    static final int SUCCESS = 0xFF2E7D32;
    static final int WARNING = 0xFFB26A00;
    static final int ERROR = 0xFFC62828;

    private Ui() { }

    static int dp(Context c, float v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    static TextView text(Context c, String value, float size, boolean bold, int color) {
        TextView t = new TextView(c);
        t.setText(value);
        t.setTextSize(size);
        t.setTextColor(color);
        t.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        return t;
    }

    static TextView title(Context c, String value) {
        TextView t = text(c, value, 24, true, INK);
        t.setPadding(0, 0, 0, dp(c, 12));
        return t;
    }

    static TextView section(Context c, String value) {
        TextView t = text(c, value, 16, true, INK);
        t.setPadding(0, dp(c, 20), 0, dp(c, 8));
        return t;
    }

    static TextView body(Context c, String value) {
        return text(c, value, 16, false, INK);
    }

    static TextView muted(Context c, String value) {
        return text(c, value, 14, false, MUTED);
    }

    private static GradientDrawable shape(Context c, int fill, int border) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(c, 8));
        if (border != 0) d.setStroke(dp(c, 1), border);
        return d;
    }

    private static TextView button(Context c, String label, int fill, int pressed, int border, int textColor) {
        TextView b = text(c, label, 16, true, textColor);
        b.setGravity(Gravity.CENTER);
        b.setMinHeight(dp(c, 52));
        b.setPadding(dp(c, 12), dp(c, 6), dp(c, 12), dp(c, 6));
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] { android.R.attr.state_pressed }, shape(c, pressed, border));
        states.addState(new int[0], shape(c, fill, border));
        b.setBackground(states);
        b.setClickable(true);
        b.setFocusable(true);
        return b;
    }

    static TextView primary(Context c, String label) {
        return button(c, label, MAROON, MAROON_DARK, 0, Color.WHITE);
    }

    static TextView secondary(Context c, String label) {
        return button(c, label, Color.WHITE, CREAM_DARK, MAROON, MAROON);
    }

    static LinearLayout column(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    static LinearLayout card(Context c) {
        LinearLayout l = column(c);
        l.setBackground(shape(c, Color.WHITE, LINE));
        int p = dp(c, 16);
        l.setPadding(p, p, p, p);
        return l;
    }

    static LinearLayout.LayoutParams gapAbove(Context c, float gap) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, gap);
        return lp;
    }

    static View divider(Context c) {
        View v = new View(c);
        v.setBackground(new ColorDrawable(LINE));
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(c, 1)));
        return v;
    }

    /** A small solid label, such as Final or Failed. */
    static TextView chip(Context c, String label, int color) {
        TextView t = text(c, label, 12, true, Color.WHITE);
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(c, 4));
        t.setBackground(d);
        t.setPadding(dp(c, 8), dp(c, 3), dp(c, 8), dp(c, 3));
        return t;
    }

    static String money(double value) {
        return String.format(java.util.Locale.US, "Rs %.2f", value);
    }

    static String statusTitle(PrintService.State s) {
        switch (s) {
            case READY: return "Ready to print";
            case CONNECTED: return "Connected to website";
            case PRINTING: return "Printing";
            case BLUETOOTH_OFF: return "Bluetooth is off";
            case NO_PRINTER: return "Printer not found";
            case NO_PAPER: return "Out of paper";
            case TOO_HOT: return "Printer is too hot";
            case NOT_RESPONDING: return "Printer not responding";
            case RECEIVER_FAILED: return "Can't receive bills";
            default: return "Starting";
        }
    }

    static String statusDetail(PrintService.State s) {
        switch (s) {
            case READY: return "Open the website and press Connect printer.";
            case CONNECTED: return "Bills from the website will print here.";
            case PRINTING: return "Please wait for the bill to come out.";
            case BLUETOOTH_OFF: return "Bills can't reach this terminal until Bluetooth is on.";
            case NO_PRINTER: return "The built-in printer isn't paired. If this continues, contact your supplier.";
            case NO_PAPER: return "Load a new roll and close the cover, then print a test page.";
            case TOO_HOT: return "Let the printer cool for a few minutes, then print a test page.";
            case NOT_RESPONDING: return "Print a test page to check it. If this continues, restart the terminal.";
            case RECEIVER_FAILED: return "Restart the receiver. If this continues, restart the terminal.";
            default: return "One moment.";
        }
    }

    /** The label of the one button that fixes this problem, or null if there is nothing to fix. */
    static String statusAction(PrintService.State s) {
        switch (s) {
            case BLUETOOTH_OFF: return "Turn on Bluetooth";
            case NO_PRINTER: return "Open Bluetooth settings";
            case NO_PAPER:
            case TOO_HOT:
            case NOT_RESPONDING: return "Print test page";
            case RECEIVER_FAILED: return "Restart receiver";
            default: return null;
        }
    }

    static int statusColor(PrintService.State s) {
        switch (s) {
            case READY:
            case CONNECTED: return SUCCESS;
            case PRINTING:
            case STARTING: return WARNING;
            default: return ERROR;
        }
    }
}
