package com.vasamo.print;

/**
 * Follows the firmware's printer state during one job, to learn whether it really finished.
 * States seen from the firmware: 1 idle, 3 printing, 4 out of paper.
 */
final class PrinterWatcher {
    enum Outcome { DONE, UNCONFIRMED, NO_PAPER, TOO_HOT }

    static final int STATE_IDLE = 1;
    static final int STATE_PRINTING = 3;
    static final int STATE_NO_PAPER = 4;

    private final long settleMs;
    private boolean sawPrinting;
    private long printingSince;
    private long idleSince;
    private Outcome failure;

    /** @param settleMs how long the printer must stay idle before the job counts as finished */
    PrinterWatcher(long settleMs) {
        this.settleMs = settleMs;
    }

    synchronized void begin() {
        sawPrinting = false;
        printingSince = 0;
        idleSince = 0;
        failure = null;
    }

    /** How long the paper was moving for the last job, or -1 if the firmware did not say. */
    synchronized long printDurationMs() {
        return printingSince > 0 && idleSince > printingSince ? idleSince - printingSince : -1;
    }

    synchronized void onState(int state) {
        if (state == STATE_PRINTING) {
            if (!sawPrinting) printingSince = System.currentTimeMillis();
            sawPrinting = true;
            idleSince = 0;
        } else if (state == STATE_IDLE) {
            if (sawPrinting) idleSince = System.currentTimeMillis();
        } else if (state == STATE_NO_PAPER) {
            failure = Outcome.NO_PAPER;
        }
        notifyAll();
    }

    synchronized void onNoPaper() {
        failure = Outcome.NO_PAPER;
        notifyAll();
    }

    synchronized void onTooHot() {
        failure = Outcome.TOO_HOT;
        notifyAll();
    }

    /** Waits for the job to finish or fail. UNCONFIRMED means the firmware reported nothing in time. */
    synchronized Outcome await(long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (true) {
            if (failure != null) return failure;
            long now = System.currentTimeMillis();
            if (idleSince > 0 && now - idleSince >= settleMs) return Outcome.DONE;
            if (now >= deadline) return Outcome.UNCONFIRMED;
            long wait = deadline - now;
            if (idleSince > 0) wait = Math.min(wait, settleMs - (now - idleSince));
            wait(Math.max(1, wait));
        }
    }
}
