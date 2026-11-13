package com.vasamo.print;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

/**
 * The P10's built-in printer. The firmware exposes it as a paired Bluetooth serial device
 * ("BluetoothPrinter", 11:22:33:44:55:66) that accepts raw ESC/POS bytes.
 */
final class BluetoothConnector implements PrinterLink.Connector {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String ADDRESS = "11:22:33:44:55:66";
    private static final String NAME = "BluetoothPrinter";

    static BluetoothDevice find() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) return null;
        for (BluetoothDevice d : adapter.getBondedDevices()) {
            if (ADDRESS.equals(d.getAddress()) || NAME.equalsIgnoreCase(d.getName())) return d;
        }
        return null;
    }

    @Override public PrinterLink.Channel connect() throws IOException {
        BluetoothDevice device = find();
        if (device == null) throw new IOException("Printer not found");
        BluetoothAdapter.getDefaultAdapter().cancelDiscovery();
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            BluetoothSocket socket = null;
            try {
                socket = open(device, attempt);
                socket.connect();
                return wrap(socket);
            } catch (IOException e) {
                last = e;
                if (socket != null) try { socket.close(); } catch (IOException ignored) { }
            }
        }
        throw new IOException("Printer connect failed", last);
    }

    private static PrinterLink.Channel wrap(BluetoothSocket socket) {
        return new PrinterLink.Channel() {
            @Override public OutputStream output() throws IOException { return socket.getOutputStream(); }
            @Override public void close() { try { socket.close(); } catch (IOException ignored) { } }
        };
    }

    private static BluetoothSocket open(BluetoothDevice device, int attempt) throws IOException {
        if (attempt == 0) return device.createRfcommSocketToServiceRecord(SPP);
        if (attempt == 1) return device.createInsecureRfcommSocketToServiceRecord(SPP);
        try { // some firmwares only answer on the fixed RFCOMM channel
            return (BluetoothSocket) device.getClass().getMethod("createRfcommSocket", int.class).invoke(device, 1);
        } catch (ReflectiveOperationException e) {
            throw new IOException("Printer connect failed", e);
        }
    }
}
