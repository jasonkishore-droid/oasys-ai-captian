package com.vasamo.print;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelUuid;
import android.os.PowerManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Receives bills from the Stock Management website over Bluetooth LE and prints them.
 *
 * Protocol (client/src/printer.js): the website writes frames of [flag, up to 100 ESC/POS bytes] to RX,
 * flag 1 marking the last frame of a job, and waits up to 20 s for "OK" or "ERR reason" as a notification on TX.
 */
public class PrintService extends Service {
    enum State { STARTING, READY, CONNECTED, PRINTING, BLUETOOTH_OFF, NO_PRINTER, NO_PAPER, TOO_HOT, NOT_RESPONDING, RECEIVER_FAILED }

    private static final UUID SERVICE = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID RX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID TX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final String ACTION_STATE = "com.pos.action.PRINTER_STATE_CHANGED";
    private static final String ACTION_NO_PAPER = "com.pos.action.PRINT_NO_PAPER";
    private static final String ACTION_HOT = "com.pos.action.PRINT_OVER_HEAT";
    private static final long PRINT_TIMEOUT_MS = 15_000; // the website gives up after 20 s
    private static final long APPROVAL_TIMEOUT_MS = 15_000;
    private static final String CHANNEL = "receiver";
    private static final int NOTIFICATION = 1;

    // Read by MainActivity on its refresh timer.
    static volatile PrintService instance;
    static volatile int revision;      // changes whenever something on screen should update
    // A job's journey, shared with the animation so the paper on screen moves with the real paper:
    static volatile byte[] animationJob;
    static volatile int animationSeq;  // a job is about to print
    static volatile int readySeq;      // the animation for it is on screen (the job is sent after this)
    static volatile int startedSeq;    // the printer reported that the paper started moving
    static volatile long startedAt;    // when (SystemClock.uptimeMillis)
    static volatile int stoppedSeq;    // the printer reported that the paper stopped
    static volatile int doneSeq;       // the printer finished
    static volatile int failedSeq;     // it failed
    private static final long ANIMATION_READY_TIMEOUT_MS = 2000;
    private volatile int currentSeq;

    private final ExecutorService printQueue = Executors.newSingleThreadExecutor();
    private final PrinterLink printer = new PrinterLink(new BluetoothConnector());
    private final PrinterWatcher watcher = new PrinterWatcher(600);
    private final JobAssembler assembler = new JobAssembler();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, BluetoothDevice> clients = new ConcurrentHashMap<>();
    private final Map<String, ByteArrayOutputStream> prepared = new ConcurrentHashMap<>();
    private final Map<String, byte[]> subscriptions = new ConcurrentHashMap<>();
    private final Map<String, Boolean> pendingApproval = new ConcurrentHashMap<>();
    private final Map<String, HeldJob> held = new ConcurrentHashMap<>();

    private BluetoothManager manager;
    private BluetoothGattServer server;
    private BluetoothGattCharacteristic tx;
    private BluetoothLeAdvertiser advertiser;
    private boolean advertising;
    private PowerManager.WakeLock wakeLock;
    private Db db;
    private Prefs prefs;

    private volatile boolean receiverFailed;
    private volatile boolean printing;
    private volatile boolean paperOut;
    private volatile boolean tooHot;
    private volatile boolean notResponding;
    private State lastNotified;

    private static final class HeldJob {
        final BluetoothDevice device;
        final byte[] job;
        HeldJob(BluetoothDevice device, byte[] job) { this.device = device; this.job = job; }
    }

    // ---- what the screens read ----

    State state() {
        BluetoothAdapter adapter = manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) return State.BLUETOOTH_OFF;
        if (BluetoothConnector.find() == null) return State.NO_PRINTER;
        if (printing) return State.PRINTING;
        if (paperOut) return State.NO_PAPER;
        if (tooHot) return State.TOO_HOT;
        if (notResponding) return State.NOT_RESPONDING;
        if (receiverFailed) return State.RECEIVER_FAILED;
        for (String address : clients.keySet()) {
            if (db.computerStatus(address) == Db.ALLOWED) return State.CONNECTED;
        }
        return State.READY;
    }

    /** The address of a computer waiting for an Allow/Block answer, or null. */
    String pendingComputer() {
        for (String address : pendingApproval.keySet()) return address;
        return null;
    }

    private void changed() {
        revision++;
        State now = state();
        if (now != lastNotified) {
            lastNotified = now;
            getSystemService(NotificationManager.class).notify(NOTIFICATION, buildNotification(now));
        }
    }

    // ---- lifecycle ----

    private final BroadcastReceiver bluetoothState = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
            if (state == BluetoothAdapter.STATE_ON) startReceiver();
            else if (state == BluetoothAdapter.STATE_TURNING_OFF || state == BluetoothAdapter.STATE_OFF) {
                stopReceiver("Bluetooth off");
                printer.close();
            }
            changed();
        }
    };

    private final BroadcastReceiver printerEvents = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (isInitialStickyBroadcast()) { // an old event, delivered because we just registered
                if (ACTION_STATE.equals(action) && intent.getIntExtra("state", 0) == PrinterWatcher.STATE_NO_PAPER) paperOut = true;
                return;
            }
            if (ACTION_STATE.equals(action)) {
                int state = intent.getIntExtra("state", 0);
                AppLog.log("Printer state " + state);
                watcher.onState(state);
                int seq = currentSeq;
                if (seq > 0 && state == PrinterWatcher.STATE_PRINTING && startedSeq != seq) {
                    startedAt = android.os.SystemClock.uptimeMillis();
                    startedSeq = seq;
                } else if (seq > 0 && state == PrinterWatcher.STATE_IDLE && startedSeq == seq) {
                    stoppedSeq = seq;
                }
                if (state == PrinterWatcher.STATE_NO_PAPER) paperOut = true;
            } else if (ACTION_NO_PAPER.equals(action)) {
                AppLog.log("Printer reported no paper");
                watcher.onNoPaper();
                paperOut = true;
            } else if (ACTION_HOT.equals(action)) {
                AppLog.log("Printer reported overheating");
                watcher.onTooHot();
                tooHot = true;
            }
            changed();
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        AppLog.init(this);
        db = Db.get(this);
        prefs = new Prefs(this);
        manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vasamo:print");
        wakeLock.setReferenceCounted(false);
        registerReceiver(bluetoothState, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED));
        IntentFilter events = new IntentFilter(ACTION_STATE);
        events.addAction(ACTION_NO_PAPER);
        events.addAction(ACTION_HOT);
        registerReceiver(printerEvents, events);
        db.purgeOlderThan(prefs.retentionDays());
        instance = this;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        lastNotified = state();
        startForeground(NOTIFICATION, buildNotification(lastNotified));
        startReceiver();
        changed();
        return START_STICKY;
    }

    @Override public void onDestroy() {
        instance = null;
        unregisterReceiver(bluetoothState);
        unregisterReceiver(printerEvents);
        stopReceiver("Stopped");
        printQueue.shutdown();
        printer.close();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotification(State state) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Bill printing", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_printer)
                .setContentTitle("Oasys Restaurant Print")
                .setContentText(Ui.statusTitle(state))
                .setContentIntent(open)
                .setOngoing(true)
                .build();
    }

    // ---- Bluetooth receiver ----

    synchronized void restartReceiver() {
        stopReceiver("Restarting");
        startReceiver();
        changed();
    }

    private synchronized void startReceiver() {
        if (server != null) return;
        receiverFailed = false;
        BluetoothAdapter adapter = manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) { AppLog.log("Bluetooth is off"); return; }
        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) { receiverFailed = true; AppLog.log("This device cannot advertise over BLE"); return; }
        server = manager.openGattServer(this, gattCallback);
        if (server == null) { receiverFailed = true; AppLog.log("Could not open GATT server"); return; }

        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(RX,
                BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE);
        tx = new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ);
        tx.addDescriptor(new BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        service.addCharacteristic(rx);
        service.addCharacteristic(tx);
        server.addService(service); // advertising starts in onServiceAdded
    }

    private synchronized void stopReceiver(String why) {
        stopAdvertising();
        if (server != null) { server.close(); server = null; }
        clients.clear();
        assembler.clear();
        prepared.clear();
        subscriptions.clear();
        pendingApproval.clear();
        held.clear();
        AppLog.log(why);
    }

    private synchronized void startAdvertising() {
        if (advertiser == null || advertising || server == null) return;
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .setTimeout(0)
                .build();
        // A 128-bit UUID and the name do not fit in one 31-byte packet, so the name goes in the scan response.
        AdvertiseData data = new AdvertiseData.Builder().setIncludeDeviceName(false).addServiceUuid(new ParcelUuid(SERVICE)).build();
        AdvertiseData response = new AdvertiseData.Builder().setIncludeDeviceName(true).build();
        advertiser.startAdvertising(settings, data, response, advertiseCallback);
        advertising = true;
    }

    private synchronized void stopAdvertising() {
        if (advertiser != null && advertising) {
            try { advertiser.stopAdvertising(advertiseCallback); } catch (IllegalStateException ignored) { /* Bluetooth already off */ }
        }
        advertising = false;
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            receiverFailed = false;
            AppLog.log("Advertising started");
            changed();
        }
        @Override public void onStartFailure(int errorCode) {
            synchronized (PrintService.this) { advertising = false; }
            if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) return;
            receiverFailed = true;
            AppLog.log("Advertising failed, code " + errorCode);
            changed();
        }
    };

    private final BluetoothGattServerCallback gattCallback = new BluetoothGattServerCallback() {
        @Override public void onServiceAdded(int status, BluetoothGattService service) {
            if (status == BluetoothGatt.GATT_SUCCESS) startAdvertising();
            else { receiverFailed = true; AppLog.log("Could not add service, status " + status); changed(); }
        }

        @Override public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            String id = device.getAddress();
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                clients.put(id, device);
                AppLog.log("Connected: " + id);
                if (db.computerStatus(id) == 0) {
                    pendingApproval.put(id, true);
                    bringToFront();
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                clients.remove(id);
                assembler.abort(id); // a half-received bill must never be printed
                prepared.remove(id);
                subscriptions.remove(id);
                pendingApproval.remove(id);
                held.remove(id);
                AppLog.log("Disconnected: " + id);
                // Some Bluetooth stacks stop advertising once a client connects.
                stopAdvertising();
                startAdvertising();
            }
            changed();
        }

        @Override public void onMtuChanged(BluetoothDevice device, int mtu) {
            AppLog.log("MTU " + mtu);
        }

        @Override public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic characteristic,
                                                           boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            boolean ok = RX.equals(characteristic.getUuid()) && value != null;
            if (ok && preparedWrite) { // a client with a small MTU sends a frame in pieces, then "execute"
                prepared.computeIfAbsent(device.getAddress(), k -> new ByteArrayOutputStream()).write(value, 0, value.length);
            }
            if (responseNeeded && server != null) {
                server.sendResponse(device, requestId, ok ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, offset, value);
            }
            if (ok && !preparedWrite) onFrame(device, value);
        }

        @Override public void onExecuteWrite(BluetoothDevice device, int requestId, boolean execute) {
            ByteArrayOutputStream frame = prepared.remove(device.getAddress());
            if (server != null) server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            if (execute && frame != null) onFrame(device, frame.toByteArray());
        }

        @Override public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor,
                                                       boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            if (value != null) subscriptions.put(device.getAddress(), value);
            if (responseNeeded && server != null) server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
        }

        @Override public void onDescriptorReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattDescriptor descriptor) {
            byte[] value = subscriptions.get(device.getAddress());
            if (value == null) value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE;
            if (server != null) server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
        }
    };

    private void onFrame(BluetoothDevice device, byte[] frame) {
        if (frame.length == 0) return;
        String id = device.getAddress();
        int status = db.computerStatus(id);
        if (status == Db.BLOCKED) { // nothing from a blocked computer is kept
            if (frame[0] == 1) { AppLog.log("Rejected job from blocked computer"); reply(device, "ERR Blocked on P10"); }
            return;
        }
        JobAssembler.Result result = assembler.frame(id, frame);
        if (result.tooLarge) { reply(device, "ERR Bill too large"); return; }
        if (result.job == null) return;
        AppLog.log("Received " + result.job.length + " bytes");
        if (status == Db.ALLOWED) {
            printQueue.execute(() -> reply(device, printFromWebsite(result.job)));
        } else {
            holdForApproval(device, result.job);
        }
    }

    /** A computer not yet approved: keep its job briefly so approving it prints straight away. */
    private void holdForApproval(BluetoothDevice device, byte[] job) {
        String id = device.getAddress();
        HeldJob entry = new HeldJob(device, job);
        held.put(id, entry);
        pendingApproval.put(id, true);
        bringToFront();
        changed();
        main.postDelayed(() -> {
            if (held.remove(id, entry)) reply(device, "ERR Approve on P10");
        }, APPROVAL_TIMEOUT_MS);
    }

    /** The answer from the Allow/Block prompt. */
    void decide(String address, boolean allow, String name) {
        db.setComputer(address, name, allow ? Db.ALLOWED : Db.BLOCKED);
        pendingApproval.remove(address);
        AppLog.log((allow ? "Allowed " : "Blocked ") + address);
        HeldJob entry = held.remove(address);
        if (entry != null) {
            if (allow) printQueue.execute(() -> reply(entry.device, printFromWebsite(entry.job)));
            else reply(entry.device, "ERR Blocked on P10");
        }
        changed();
    }

    private synchronized void reply(BluetoothDevice device, String text) {
        if (server == null || tx == null) return;
        tx.setValue(text.getBytes(StandardCharsets.UTF_8));
        server.notifyCharacteristicChanged(device, tx, false);
    }

    @SuppressWarnings("deprecation") // the only way for a service to switch the screen on
    private void bringToFront() {
        if (!prefs.wakeScreen()) return;
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (!power.isInteractive()) {
            power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                    "vasamo:screen").acquire(5_000);
        }
        try {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException e) { // showing the screen must never get in the way of printing
            AppLog.log("Could not open the screen: " + e);
        }
    }

    // ---- printing ----

    private String printFromWebsite(byte[] job) {
        BillInfo info = BillInfo.from(EscPos.parse(job));
        if (info.kind == BillInfo.Kind.TEST) return send(job);
        // The same final bill printed again is a reprint, wherever the request came from.
        boolean duplicate = info.kind == BillInfo.Kind.FINAL && db.printedCopy(info.number) != null;
        String reply = send(duplicate ? EscPos.markDuplicate(job) : job);
        db.save(info, job, reply.equals("OK"));
        db.purgeOlderThan(prefs.retentionDays());
        changed();
        return reply;
    }

    /** Runs on the print queue. Returns the reply for the website: "OK" or "ERR reason". */
    private String send(byte[] job) {
        wakeLock.acquire(60_000);
        printing = true;
        changed();
        animationJob = job;
        int seq = ++animationSeq;
        currentSeq = seq;
        try {
            waitForAnimation(seq);
            watcher.begin();
            printer.print(job);
            notResponding = false;
            PrinterWatcher.Outcome outcome = watcher.await(PRINT_TIMEOUT_MS);
            AppLog.log("Print outcome: " + outcome);
            switch (outcome) {
                case NO_PAPER:
                    failedSeq = seq;
                    return "ERR Out of paper";
                case TOO_HOT:
                    failedSeq = seq;
                    return "ERR Printer too hot";
                default:
                    doneSeq = seq;
                    paperOut = false;
                    tooHot = false;
                    long took = watcher.printDurationMs();
                    if (took > 0) {
                        float lines = EscPos.paperLines(EscPos.parse(job));
                        prefs.learnPrintSpeed(took, lines);
                        AppLog.log("Printed " + Math.round(lines) + " lines in " + took + " ms");
                    }
                    return "OK";
            }
        } catch (IOException e) {
            AppLog.log("Print failed: " + e);
            notResponding = true;
            failedSeq = seq;
            return "ERR Printer not responding";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            failedSeq = seq;
            return "ERR Printer not responding";
        } finally {
            currentSeq = 0;
            printing = false;
            wakeLock.release();
            changed();
        }
    }

    /**
     * Brings the screen up and holds the job until its animation is showing, so the paper on screen
     * and the real paper start together. Never waits long: printing matters more than the animation.
     */
    private void waitForAnimation(int seq) throws InterruptedException {
        bringToFront();
        boolean willShow = prefs.animation() && (prefs.wakeScreen() || MainActivity.visible);
        if (!willShow) return;
        long deadline = System.currentTimeMillis() + ANIMATION_READY_TIMEOUT_MS;
        while (readySeq < seq && System.currentTimeMillis() < deadline) Thread.sleep(20);
        if (readySeq < seq) AppLog.log("Animation not ready in time, printing anyway");
    }

    /** The Print test page button. */
    void printTestPage() {
        String when = new SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.US).format(new Date());
        printQueue.execute(() -> AppLog.log("Test page: " + send(EscPos.testPage(when))));
    }

    /** The Reprint button. A bill that never printed goes out as an original, not a duplicate. */
    void reprint(long id) {
        printQueue.execute(() -> {
            Db.Bill bill = db.bill(id);
            byte[] job = db.job(id);
            if (bill == null || job == null) return;
            String reply = send(bill.printed ? EscPos.markDuplicate(job) : job);
            AppLog.log("Reprint: " + reply);
            if (reply.equals("OK")) db.markPrinted(id, bill.printed);
            changed();
        });
    }
}
