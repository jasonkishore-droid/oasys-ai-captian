package com.vasamo.print;

import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.OutputStream;

/** Hosts the bottom tabs, the first-run checklist, the Allow/Block prompt and the receipt animation. */
public class MainActivity extends Activity implements Tabs.Host {
    private static final long REFRESH_MS = 100;
    static volatile boolean visible;
    private static final int REQUEST_EXPORT = 1;
    private static final String[] TAB_LABELS = { "Home", "Bills", "Printer", "Settings" };
    private static final int[] TAB_ICONS = { R.drawable.ic_home, R.drawable.ic_bills, R.drawable.ic_printer, R.drawable.ic_settings };
    private static int shownSeq = 0; // the last print animated; outlives the activity

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Tabs.Tab[] tabs;
    private Tabs.Bills bills;
    private FrameLayout page;
    private LinearLayout tabBar;
    private int current = 0;
    private int seenRevision = -1;
    private int playingSeq = -1;
    private ReceiptFeedView feed;
    private Prefs prefs;
    private ScrollView setup;
    private AlertDialog approval;
    private String approvalFor;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (seenRevision != PrintService.revision) {
                seenRevision = PrintService.revision;
                tabs[current].refresh();
                if (setup != null) drawSetup();
            }
            checkApproval();
            checkAnimation();
            handler.postDelayed(this, REFRESH_MS);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppLog.init(this);
        prefs = new Prefs(this);
        startForegroundService(new Intent(this, PrintService.class));

        bills = new Tabs.Bills(this, this);
        tabs = new Tabs.Tab[] { new Tabs.Home(this, this), bills, new Tabs.Printer(this, this), new Tabs.Settings(this, this) };

        LinearLayout root = Ui.column(this);
        root.setBackgroundColor(Ui.CREAM);
        page = new FrameLayout(this);
        root.addView(page, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(Ui.divider(this));
        tabBar = new LinearLayout(this);
        tabBar.setBackgroundColor(Color.WHITE);
        for (int i = 0; i < tabs.length; i++) {
            final int index = i;
            LinearLayout item = Ui.column(this);
            item.setGravity(Gravity.CENTER);
            item.setMinimumHeight(Ui.dp(this, 64));
            item.setClickable(true);
            ImageView icon = new ImageView(this);
            icon.setImageResource(TAB_ICONS[i]);
            item.addView(icon, new LinearLayout.LayoutParams(Ui.dp(this, 26), Ui.dp(this, 26)));
            TextView label = Ui.text(this, TAB_LABELS[i], 13, true, Ui.MUTED);
            label.setGravity(Gravity.CENTER);
            item.addView(label);
            item.setOnClickListener(v -> select(index));
            tabBar.addView(item, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        root.addView(tabBar);

        feed = new ReceiptFeedView(this);
        feed.setVisibility(View.GONE);
        FrameLayout stack = new FrameLayout(this);
        stack.addView(root);
        stack.addView(feed, new FrameLayout.LayoutParams(-1, -1));
        setContentView(stack);
        select(0);
        if (!prefs.setupDone()) showSetup();
    }

    private void select(int index) {
        current = index;
        page.removeAllViews();
        page.addView(tabs[index].view());
        for (int i = 0; i < tabBar.getChildCount(); i++) {
            LinearLayout item = (LinearLayout) tabBar.getChildAt(i);
            int color = i == index ? Ui.MAROON : Ui.MUTED;
            ((ImageView) item.getChildAt(0)).setColorFilter(color);
            ((TextView) item.getChildAt(1)).setTextColor(color);
        }
        tabs[index].refresh();
    }

    @Override protected void onResume() {
        super.onResume();
        visible = true;
        seenRevision = -1; // settings may have changed while we were away
        handler.post(tick);
    }

    @Override protected void onPause() {
        visible = false;
        handler.removeCallbacks(tick);
        super.onPause();
    }

    @Override public void onBackPressed() {
        if (setup != null) { closeSetup(); return; }
        if (tabs[current].back()) return;
        if (current != 0) { select(0); return; }
        moveTaskToBack(true); // keep running: bills must still print
    }

    // ---- animation ----

    private void checkAnimation() {
        if (feed.isPlaying() && playingSeq == PrintService.failedSeq) {
            feed.cancel();
            return;
        }
        int seq = PrintService.animationSeq;
        byte[] job = PrintService.animationJob;
        if (feed.isPlaying() || job == null || seq == shownSeq) return;
        shownSeq = seq;
        if (!prefs.animation() || seq == PrintService.failedSeq || seq <= PrintService.doneSeq) return; // too late to match the paper
        playingSeq = seq;
        java.util.List<EscPos.Line> lines = EscPos.parse(job);
        long expectedMs = prefs.expectedPrintMs(EscPos.paperLines(lines));
        feed.play(lines, seq, expectedMs, () -> { playingSeq = -1; seenRevision = -1; });
    }

    // ---- allow / block prompt ----

    private void checkApproval() {
        PrintService s = service();
        String pending = s == null ? null : s.pendingComputer();
        if (approval != null && (pending == null || !pending.equals(approvalFor))) {
            approval.dismiss(); // the computer went away
            approval = null;
            approvalFor = null;
        }
        if (pending == null || approval != null) return;

        approvalFor = pending;
        int p = Ui.dp(this, 20);
        LinearLayout box = Ui.column(this);
        box.setPadding(p, p, p, 0);
        box.addView(Ui.body(this, "A computer wants to print on this terminal. Only allow it if you recognise it."));
        TextView label = Ui.muted(this, "Name this computer");
        label.setPadding(0, Ui.dp(this, 16), 0, 0);
        box.addView(label);
        EditText name = new EditText(this);
        name.setSingleLine(true);
        name.setText(Db.get(this).nextComputerName());
        box.addView(name);
        approval = new AlertDialog.Builder(this, R.style.AppDialog)
                .setTitle("Allow this computer?")
                .setView(box)
                .setCancelable(false)
                .setPositiveButton("Allow", (d, w) -> answer(pending, true, name))
                .setNegativeButton("Block", (d, w) -> answer(pending, false, name))
                .create();
        approval.show();
    }

    private void answer(String address, boolean allow, EditText name) {
        approval = null;
        approvalFor = null;
        String typed = name.getText().toString().trim();
        PrintService s = service();
        if (s != null) s.decide(address, allow, typed.isEmpty() ? Db.get(this).nextComputerName() : typed);
        seenRevision = -1;
    }

    // ---- Tabs.Host ----

    @Override public PrintService service() { return PrintService.instance; }

    @Override public void fix(PrintService.State state) {
        switch (state) {
            case BLUETOOTH_OFF:
                startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
                break;
            case NO_PRINTER:
                startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
                break;
            case RECEIVER_FAILED:
                if (service() != null) service().restartReceiver();
                break;
            default:
                if (service() != null) service().printTestPage();
        }
    }

    @Override public void openBill(long id) {
        select(1);
        bills.open(id);
    }

    @Override public void confirmReprint(Db.Bill bill) {
        String message = bill.printed
                ? "This bill will print again with DUPLICATE COPY at the top."
                : "This bill didn't print last time. Print it now?";
        new AlertDialog.Builder(this, R.style.AppDialog)
                .setTitle(bill.printed ? "Reprint this bill?" : "Print this bill?")
                .setMessage(message)
                .setPositiveButton(bill.printed ? "Reprint" : "Print", (d, w) -> { if (service() != null) service().reprint(bill.id); })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override public void renameComputer(Db.Computer computer) {
        EditText name = new EditText(this);
        name.setSingleLine(true);
        name.setText(computer.name);
        LinearLayout box = Ui.column(this);
        int p = Ui.dp(this, 20);
        box.setPadding(p, p, p, 0);
        box.addView(name);
        new AlertDialog.Builder(this, R.style.AppDialog)
                .setTitle("Rename computer")
                .setView(box)
                .setPositiveButton("Save", (d, w) -> {
                    String typed = name.getText().toString().trim();
                    if (!typed.isEmpty()) Db.get(this).setComputer(computer.address, typed, computer.status);
                    tabs[current].refresh();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override public void confirmForget(Db.Computer computer) {
        new AlertDialog.Builder(this, R.style.AppDialog)
                .setTitle("Remove " + computer.name + "?")
                .setMessage("It will need to be allowed again before it can print.")
                .setPositiveButton("Remove", (d, w) -> { Db.get(this).forgetComputer(computer.address); tabs[current].refresh(); })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override public void exportLogs() {
        startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TITLE, "vasamo-print-log.txt"), REQUEST_EXPORT);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_EXPORT || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
            out.write(AppLog.export());
            Toast.makeText(this, "Logs saved", Toast.LENGTH_SHORT).show();
        } catch (IOException e) {
            Toast.makeText(this, "Could not save the logs", Toast.LENGTH_LONG).show();
        }
    }

    // ---- first-run checklist ----

    @Override public void showSetup() {
        if (setup != null) return;
        setup = new ScrollView(this);
        setup.setBackgroundColor(Ui.CREAM);
        setup.setFillViewport(true);
        ((FrameLayout) feed.getParent()).addView(setup, 1, new FrameLayout.LayoutParams(-1, -1));
        drawSetup();
    }

    private void closeSetup() {
        ((ViewGroup) setup.getParent()).removeView(setup);
        setup = null;
        seenRevision = -1;
    }

    private boolean bluetoothOn() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        return adapter != null && adapter.isEnabled();
    }

    private void drawSetup() {
        int y = setup.getScrollY();
        setup.removeAllViews();
        LinearLayout box = Ui.column(this);
        int p = Ui.dp(this, 16);
        box.setPadding(p, p, p, p);
        box.addView(Ui.title(this, "Set up Vasamo Print"));
        box.addView(Ui.muted(this, "Check each item once. It only takes a minute."));

        boolean bluetooth = bluetoothOn();
        boolean printer = bluetooth && BluetoothConnector.find() != null;
        boolean overlay = Settings.canDrawOverlays(this);
        boolean battery = ((PowerManager) getSystemService(POWER_SERVICE)).isIgnoringBatteryOptimizations(getPackageName());

        box.addView(check("Bluetooth is on", "Bills arrive over Bluetooth.", bluetooth, "Turn on",
                () -> startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))), Ui.gapAbove(this, 16));
        box.addView(check("Printer found", "The built-in printer is ready.", printer, "Open settings",
                () -> startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS))), Ui.gapAbove(this, 8));
        box.addView(check("Show bills when they print", "Lets the app appear over other apps.", overlay, "Allow",
                () -> startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())))), Ui.gapAbove(this, 8));
        box.addView(check("Keep running in the background", "Stops the system from closing the app.", battery, "Allow",
                () -> startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())))), Ui.gapAbove(this, 8));

        TextView done = Ui.primary(this, bluetooth && printer ? "Done" : "Skip for now");
        done.setOnClickListener(v -> { prefs.setupDone(true); closeSetup(); });
        box.addView(done, Ui.gapAbove(this, 20));
        setup.addView(box);
        setup.post(() -> { if (setup != null) setup.scrollTo(0, y); });
    }

    private View check(String title, String hint, boolean ok, String action, Runnable fix) {
        LinearLayout card = Ui.card(this);
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.addView(Ui.text(this, title, 16, true, Ui.INK), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        top.addView(Ui.chip(this, ok ? "Done" : "To do", ok ? Ui.SUCCESS : Ui.WARNING));
        card.addView(top);
        card.addView(Ui.muted(this, hint));
        if (!ok) {
            TextView button = Ui.secondary(this, action);
            button.setOnClickListener(v -> fix.run());
            card.addView(button, Ui.gapAbove(this, 8));
        }
        return card;
    }
}
