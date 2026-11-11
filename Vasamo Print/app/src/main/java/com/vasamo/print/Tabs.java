package com.vasamo.print;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** The four bottom tabs. Each one builds its view once and redraws its contents on refresh(). */
final class Tabs {
    private Tabs() { }

    interface Host {
        PrintService service();
        void fix(PrintService.State state);
        void openBill(long id);
        void confirmReprint(Db.Bill bill);
        void showSetup();
        void exportLogs();
        void renameComputer(Db.Computer computer);
        void confirmForget(Db.Computer computer);
    }

    abstract static class Tab {
        final Context c;
        final Host host;
        final Db db;
        final ScrollView scroll;
        final LinearLayout content;

        Tab(Context c, Host host) {
            this.c = c;
            this.host = host;
            this.db = Db.get(c);
            scroll = new ScrollView(c);
            scroll.setBackgroundColor(Ui.CREAM);
            scroll.setFillViewport(true);
            content = Ui.column(c);
            int p = Ui.dp(c, 16);
            content.setPadding(p, p, p, p);
            scroll.addView(content);
        }

        View view() { return scroll; }
        abstract void refresh();
        boolean back() { return false; }
    }

    private static PrintService.State stateOf(Host host) {
        PrintService s = host.service();
        return s == null ? PrintService.State.STARTING : s.state();
    }

    private static String billTitle(Db.Bill b) {
        return b.number != null ? b.number : "Preview";
    }

    private static TextView billChip(Context c, Db.Bill b) {
        if (!b.printed) return Ui.chip(c, "Failed", Ui.ERROR);
        if (b.isVoid) return Ui.chip(c, "Void", Ui.MUTED);
        if (b.kind == BillInfo.Kind.PREVIEW) return Ui.chip(c, "Preview", Ui.WARNING);
        return Ui.chip(c, "Final", Ui.SUCCESS);
    }

    private static View billRow(Context c, Db.Bill b, Host host) {
        LinearLayout row = new LinearLayout(c);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(Ui.dp(c, 64));
        row.setPadding(0, Ui.dp(c, 8), 0, Ui.dp(c, 8));
        LinearLayout left = Ui.column(c);
        left.addView(Ui.text(c, billTitle(b), 16, true, Ui.INK));
        String when = new SimpleDateFormat("hh:mm a", Locale.US).format(new Date(b.time));
        left.addView(Ui.muted(c, b.guest.isEmpty() ? when : when + "  ·  " + b.guest));
        row.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout right = Ui.column(c);
        right.setGravity(Gravity.END);
        right.addView(Ui.text(c, Ui.money(b.total), 16, true, Ui.INK));
        right.addView(billChip(c, b));
        row.addView(right);
        row.setOnClickListener(v -> host.openBill(b.id));
        return row;
    }

    // ---- Home ----

    static final class Home extends Tab {
        Home(Context c, Host host) { super(c, host); }

        @Override void refresh() {
            content.removeAllViews();
            PrintService.State state = stateOf(host);

            LinearLayout status = Ui.column(c);
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Ui.statusColor(state));
            bg.setCornerRadius(Ui.dp(c, 8));
            status.setBackground(bg);
            int p = Ui.dp(c, 20);
            status.setPadding(p, p, p, p);
            status.addView(Ui.text(c, Ui.statusTitle(state), 28, true, Color.WHITE));
            TextView detail = Ui.text(c, Ui.statusDetail(state), 16, false, Color.WHITE);
            detail.setPadding(0, Ui.dp(c, 6), 0, 0);
            status.addView(detail);
            content.addView(status);

            String action = Ui.statusAction(state);
            if (action != null) {
                TextView fix = Ui.primary(c, action);
                fix.setOnClickListener(v -> host.fix(state));
                content.addView(fix, Ui.gapAbove(c, 12));
            }

            LinearLayout today = Ui.card(c);
            today.addView(Ui.muted(c, "Bills printed today"));
            today.addView(Ui.text(c, String.valueOf(db.printedToday()), 36, true, Ui.INK));
            content.addView(today, Ui.gapAbove(c, 12));

            content.addView(Ui.section(c, "Last bill"));
            Db.Bill last = db.latest();
            LinearLayout card = Ui.card(c);
            if (last == null) card.addView(Ui.muted(c, "No bills yet. Printed bills will appear here."));
            else card.addView(billRow(c, last, host));
            content.addView(card);
        }
    }

    // ---- Bills ----

    static final class Bills extends Tab {
        private static final int LIMIT = 200;
        private final LinearLayout list;
        private final EditText search;
        private final LinearLayout listScreen;
        private long openId = -1;
        private int lastReprints = -1;

        Bills(Context c, Host host) {
            super(c, host);
            listScreen = Ui.column(c);
            listScreen.addView(Ui.title(c, "Bills"));
            search = new EditText(c);
            search.setHint("Search bill number or guest");
            search.setSingleLine(true);
            search.setInputType(InputType.TYPE_CLASS_TEXT);
            search.setTextColor(Ui.INK);
            GradientDrawable box = new GradientDrawable();
            box.setColor(Color.WHITE);
            box.setCornerRadius(Ui.dp(c, 8));
            box.setStroke(Ui.dp(c, 1), Ui.LINE);
            search.setBackground(box);
            search.setMinHeight(Ui.dp(c, 52));
            search.setPadding(Ui.dp(c, 12), 0, Ui.dp(c, 12), 0);
            search.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int a, int b, int d) { }
                @Override public void onTextChanged(CharSequence s, int a, int b, int d) { }
                @Override public void afterTextChanged(Editable s) { drawList(); }
            });
            listScreen.addView(search);
            list = Ui.column(c);
            listScreen.addView(list);
        }

        void open(long id) {
            openId = id;
            lastReprints = -1;
            refresh();
            scroll.scrollTo(0, 0);
        }

        @Override boolean back() {
            if (openId < 0) return false;
            openId = -1;
            refresh();
            return true;
        }

        @Override void refresh() {
            Db.Bill open = openId >= 0 ? db.bill(openId) : null;
            if (open != null) {
                drawDetail(open);
                return;
            }
            openId = -1;
            if (listScreen.getParent() == null) {
                content.removeAllViews();
                content.addView(listScreen);
            }
            drawList();
        }

        private void drawList() {
            list.removeAllViews();
            List<Db.Bill> bills = db.bills(search.getText().toString(), LIMIT);
            if (bills.isEmpty()) {
                TextView none = Ui.muted(c, search.getText().length() > 0 ? "No bills match your search." : "No bills yet. Printed bills will appear here.");
                none.setPadding(0, Ui.dp(c, 24), 0, 0);
                none.setGravity(Gravity.CENTER);
                list.addView(none);
                return;
            }
            SimpleDateFormat day = new SimpleDateFormat("EEE, dd MMM yyyy", Locale.US);
            String current = "";
            LinearLayout card = null;
            for (Db.Bill b : bills) {
                String label = day.format(new Date(b.time));
                if (!label.equals(current)) {
                    current = label;
                    list.addView(Ui.section(c, label));
                    card = Ui.card(c);
                    card.setPadding(Ui.dp(c, 16), Ui.dp(c, 4), Ui.dp(c, 16), Ui.dp(c, 4));
                    list.addView(card);
                } else {
                    card.addView(Ui.divider(c));
                }
                card.addView(billRow(c, b, host));
            }
        }

        private void drawDetail(Db.Bill b) {
            if (b.reprints == lastReprints && content.getChildAt(0) != listScreen && content.getChildCount() > 0) {
                return; // nothing changed: keep the scroll position and avoid redrawing the receipt
            }
            lastReprints = b.reprints;
            content.removeAllViews();
            TextView backButton = Ui.secondary(c, "Back to bills");
            backButton.setOnClickListener(v -> back());
            content.addView(backButton);

            TextView heading = Ui.title(c, billTitle(b));
            heading.setPadding(0, Ui.dp(c, 16), 0, Ui.dp(c, 4));
            content.addView(heading);
            String when = new SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.US).format(new Date(b.time));
            content.addView(Ui.muted(c, b.reprints > 0 ? when + "  ·  Reprinted " + b.reprints + "x" : when));

            TextView reprint = Ui.primary(c, b.printed ? "Reprint" : "Print");
            reprint.setOnClickListener(v -> host.confirmReprint(b));
            content.addView(reprint, Ui.gapAbove(c, 12));

            byte[] job = db.job(b.id);
            if (job != null) {
                int width = Math.round(c.getResources().getDisplayMetrics().widthPixels * 0.86f);
                Bitmap receipt = ReceiptRenderer.render(EscPos.parse(job), width, c.getResources().getDisplayMetrics().density);
                ImageView image = new ImageView(c);
                image.setImageBitmap(receipt);
                image.setAdjustViewBounds(true);
                image.setBackgroundColor(Ui.CREAM_DARK);
                int p = Ui.dp(c, 8);
                image.setPadding(p, p, p, p);
                content.addView(image, Ui.gapAbove(c, 16));
            }
        }
    }

    // ---- Printer ----

    static final class Printer extends Tab {
        private boolean showDiagnostics;

        Printer(Context c, Host host) { super(c, host); }

        private void row(LinearLayout card, String label, String value, int color) {
            LinearLayout r = new LinearLayout(c);
            r.setGravity(Gravity.CENTER_VERTICAL);
            r.setMinimumHeight(Ui.dp(c, 48));
            r.addView(Ui.body(c, label), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            r.addView(Ui.text(c, value, 16, true, color));
            card.addView(r);
        }

        @Override void refresh() {
            int y = scroll.getScrollY();
            content.removeAllViews();
            content.addView(Ui.title(c, "Printer"));
            PrintService.State state = stateOf(host);
            boolean bluetooth = state != PrintService.State.BLUETOOTH_OFF;
            boolean found = bluetooth && state != PrintService.State.NO_PRINTER;

            LinearLayout card = Ui.card(c);
            card.setPadding(Ui.dp(c, 16), Ui.dp(c, 4), Ui.dp(c, 16), Ui.dp(c, 4));
            row(card, "Bluetooth", bluetooth ? "On" : "Off", bluetooth ? Ui.SUCCESS : Ui.ERROR);
            card.addView(Ui.divider(c));
            row(card, "Built-in printer", found ? "Found" : "Not found", found ? Ui.SUCCESS : Ui.ERROR);
            card.addView(Ui.divider(c));
            boolean noPaper = state == PrintService.State.NO_PAPER;
            row(card, "Paper", noPaper ? "Out or cover open" : "OK", noPaper ? Ui.ERROR : Ui.SUCCESS);
            card.addView(Ui.divider(c));
            row(card, "Website", state == PrintService.State.CONNECTED || state == PrintService.State.PRINTING ? "Connected" : "Not connected",
                    state == PrintService.State.CONNECTED || state == PrintService.State.PRINTING ? Ui.SUCCESS : Ui.MUTED);
            content.addView(card);

            TextView test = Ui.primary(c, "Print test page");
            test.setOnClickListener(v -> { if (host.service() != null) host.service().printTestPage(); });
            content.addView(test, Ui.gapAbove(c, 12));

            content.addView(Ui.section(c, "Connect from the website"));
            LinearLayout guide = Ui.card(c);
            guide.addView(Ui.body(c, "1.  Open Stock Management in Chrome or Edge."));
            TextView two = Ui.body(c, "2.  Press Connect printer at the top.");
            two.setPadding(0, Ui.dp(c, 8), 0, 0);
            guide.addView(two);
            TextView three = Ui.body(c, "3.  Choose P10, then tap Allow on this terminal.");
            three.setPadding(0, Ui.dp(c, 8), 0, 0);
            guide.addView(three);
            content.addView(guide);

            TextView toggle = Ui.secondary(c, showDiagnostics ? "Hide diagnostics" : "Show diagnostics");
            toggle.setOnClickListener(v -> { showDiagnostics = !showDiagnostics; refresh(); });
            content.addView(toggle, Ui.gapAbove(c, 20));
            if (showDiagnostics) {
                TextView restart = Ui.secondary(c, "Restart receiver");
                restart.setOnClickListener(v -> { if (host.service() != null) host.service().restartReceiver(); });
                content.addView(restart, Ui.gapAbove(c, 8));
                LinearLayout log = Ui.card(c);
                String recent = AppLog.recent();
                log.addView(Ui.text(c, recent.isEmpty() ? "Nothing logged yet." : recent, 11, false, Ui.MUTED));
                content.addView(log, Ui.gapAbove(c, 8));
            }
            scroll.post(() -> scroll.scrollTo(0, y));
        }
    }

    // ---- Settings ----

    static final class Settings extends Tab {
        private final Prefs prefs;

        Settings(Context c, Host host) {
            super(c, host);
            prefs = new Prefs(c);
        }

        private View toggle(String label, String hint, boolean on, java.util.function.Consumer<Boolean> set) {
            LinearLayout r = new LinearLayout(c);
            r.setGravity(Gravity.CENTER_VERTICAL);
            r.setMinimumHeight(Ui.dp(c, 64));
            LinearLayout text = Ui.column(c);
            text.addView(Ui.body(c, label));
            text.addView(Ui.muted(c, hint));
            r.addView(text, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Switch s = new Switch(c);
            s.setChecked(on);
            s.setOnCheckedChangeListener((v, checked) -> set.accept(checked));
            r.addView(s);
            return r;
        }

        @Override void refresh() {
            int y = scroll.getScrollY();
            content.removeAllViews();
            content.addView(Ui.title(c, "Settings"));

            LinearLayout options = Ui.card(c);
            options.setPadding(Ui.dp(c, 16), Ui.dp(c, 4), Ui.dp(c, 16), Ui.dp(c, 4));
            options.addView(toggle("Receipt animation", "Show the bill coming out of the printer", prefs.animation(), prefs::animation));
            options.addView(Ui.divider(c));
            options.addView(toggle("Wake screen for new bills", "Turn the screen on when a bill prints", prefs.wakeScreen(), prefs::wakeScreen));
            content.addView(options);

            content.addView(Ui.section(c, "Keep bill history for"));
            LinearLayout days = new LinearLayout(c);
            for (int d : new int[] { 7, 30, 90 }) {
                TextView b = d == prefs.retentionDays() ? Ui.primary(c, d + " days") : Ui.secondary(c, d + " days");
                b.setOnClickListener(v -> {
                    prefs.retentionDays(d);
                    db.purgeOlderThan(d);
                    refresh();
                });
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
                if (d != 7) lp.leftMargin = Ui.dp(c, 8);
                days.addView(b, lp);
            }
            content.addView(days);

            content.addView(Ui.section(c, "Allowed computers"));
            LinearLayout computers = Ui.card(c);
            computers.setPadding(Ui.dp(c, 16), Ui.dp(c, 4), Ui.dp(c, 16), Ui.dp(c, 4));
            List<Db.Computer> known = db.computers();
            if (known.isEmpty()) {
                TextView none = Ui.muted(c, "None yet. When a computer connects, this terminal will ask you to allow it.");
                none.setPadding(0, Ui.dp(c, 12), 0, Ui.dp(c, 12));
                computers.addView(none);
            }
            for (int i = 0; i < known.size(); i++) {
                Db.Computer k = known.get(i);
                if (i > 0) computers.addView(Ui.divider(c));
                computers.addView(computerRow(k));
            }
            content.addView(computers);

            content.addView(Ui.section(c, "App"));
            TextView setup = Ui.secondary(c, "Run setup checklist");
            setup.setOnClickListener(v -> host.showSetup());
            content.addView(setup);
            TextView logs = Ui.secondary(c, "Export logs");
            logs.setOnClickListener(v -> host.exportLogs());
            content.addView(logs, Ui.gapAbove(c, 8));
            TextView version = Ui.muted(c, "Vasamo Print version " + version());
            version.setGravity(Gravity.CENTER);
            version.setPadding(0, Ui.dp(c, 16), 0, 0);
            content.addView(version);
            scroll.post(() -> scroll.scrollTo(0, y));
        }

        private View computerRow(Db.Computer k) {
            LinearLayout box = Ui.column(c);
            box.setPadding(0, Ui.dp(c, 10), 0, Ui.dp(c, 10));
            LinearLayout top = new LinearLayout(c);
            top.setGravity(Gravity.CENTER_VERTICAL);
            top.addView(Ui.text(c, k.name, 16, true, Ui.INK), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            boolean allowed = k.status == Db.ALLOWED;
            top.addView(Ui.chip(c, allowed ? "Allowed" : "Blocked", allowed ? Ui.SUCCESS : Ui.ERROR));
            box.addView(top);

            LinearLayout actions = new LinearLayout(c);
            TextView rename = Ui.secondary(c, "Rename");
            rename.setOnClickListener(v -> host.renameComputer(k));
            TextView flip = Ui.secondary(c, allowed ? "Block" : "Allow");
            flip.setOnClickListener(v -> { db.setComputer(k.address, k.name, allowed ? Db.BLOCKED : Db.ALLOWED); refresh(); });
            TextView forget = Ui.secondary(c, "Remove");
            forget.setOnClickListener(v -> host.confirmForget(k));
            LinearLayout.LayoutParams a = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            LinearLayout.LayoutParams b = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            b.leftMargin = Ui.dp(c, 8);
            LinearLayout.LayoutParams d = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            d.leftMargin = Ui.dp(c, 8);
            actions.addView(rename, a);
            actions.addView(flip, b);
            actions.addView(forget, d);
            box.addView(actions, Ui.gapAbove(c, 8));
            return box;
        }

        private String version() {
            try {
                return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
