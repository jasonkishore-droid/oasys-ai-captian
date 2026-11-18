package com.vasamo.print;

import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Joins Bluetooth frames into whole jobs, one buffer per computer. A frame is [flag, data...] and
 * flag 1 marks the last one. A job is only ever handed over complete.
 */
final class JobAssembler {
    static final int MAX_JOB = 512 * 1024;

    static final class Result {
        final byte[] job;       // the finished job, or null
        final boolean tooLarge; // the job went over the limit and was dropped

        Result(byte[] job, boolean tooLarge) {
            this.job = job;
            this.tooLarge = tooLarge;
        }
    }

    private static final Result PENDING = new Result(null, false);
    private final Map<String, ByteArrayOutputStream> jobs = new HashMap<>();
    private final Map<String, Boolean> overflowed = new HashMap<>();

    synchronized Result frame(String client, byte[] frame) {
        if (frame.length == 0) return PENDING;
        boolean last = frame[0] == 1;
        if (Boolean.TRUE.equals(overflowed.get(client))) { // ignore the rest of an oversized job
            if (!last) return PENDING;
            overflowed.remove(client);
            return new Result(null, true);
        }
        ByteArrayOutputStream job = jobs.get(client);
        if (job == null) {
            job = new ByteArrayOutputStream();
            jobs.put(client, job);
        }
        if (job.size() + frame.length - 1 > MAX_JOB) {
            jobs.remove(client);
            if (last) return new Result(null, true);
            overflowed.put(client, true);
            return PENDING;
        }
        job.write(frame, 1, frame.length - 1);
        if (!last) return PENDING;
        jobs.remove(client);
        return new Result(job.toByteArray(), false);
    }

    /** The computer disconnected: whatever it sent so far must never print. */
    synchronized void abort(String client) {
        jobs.remove(client);
        overflowed.remove(client);
    }

    synchronized void clear() {
        jobs.clear();
        overflowed.clear();
    }
}
