package com.vasamo.print;

import java.io.IOException;
import java.io.OutputStream;

/** Sends whole jobs down a connection to the printer. */
final class PrinterLink {
    interface Channel {
        OutputStream output() throws IOException;
        void close();
    }

    interface Connector {
        Channel connect() throws IOException;
    }

    static final int CHUNK = 512;

    private final Connector connector;
    private Channel channel;

    PrinterLink(Connector connector) {
        this.connector = connector;
    }

    /**
     * A connection left open can be stale, so if the very first write fails it reconnects and tries
     * again. A failure later than that is reported and never retried, because part of the bill may
     * already be on paper and a retry would print it twice.
     */
    synchronized void print(byte[] data) throws IOException {
        boolean reused = channel != null;
        if (!reused) channel = connector.connect();
        int first = Math.min(CHUNK, data.length);
        OutputStream out;
        try {
            out = channel.output();
            out.write(data, 0, first);
            out.flush();
        } catch (IOException e) {
            close();
            if (!reused) throw e;
            channel = connector.connect();
            try {
                out = channel.output();
                out.write(data, 0, first);
                out.flush();
            } catch (IOException again) {
                close();
                throw again;
            }
        }
        try {
            for (int i = first; i < data.length; i += CHUNK) {
                out.write(data, i, Math.min(CHUNK, data.length - i));
                out.flush();
            }
        } catch (IOException e) {
            close();
            throw e;
        }
    }

    synchronized void close() {
        if (channel != null) {
            channel.close();
            channel = null;
        }
    }
}
