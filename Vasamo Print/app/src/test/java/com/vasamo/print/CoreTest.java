package com.vasamo.print;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

public class CoreTest {
    private static byte[] ascii(String s) { return s.getBytes(StandardCharsets.US_ASCII); }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) out.write(p, 0, p.length);
        return out.toByteArray();
    }

    private static byte[] bill(String header, String number) {
        return concat(new byte[] { 0x1b, '@' }, ascii(header + "VASAMO\nTAX INVOICE\nBill No      " + number
                + "\nGuest   Asha\nTOTAL  Rs 116.00\n"));
    }

    // ---- parser ----

    @Test public void readsAlignBoldAndBig() {
        byte[] job = concat(new byte[] { 0x1b, '@', 0x1b, 'a', 1, 0x1b, 'E', 1, 0x1d, '!', 0x11 }, ascii("HI\n"),
                new byte[] { 0x1d, '!', 0, 0x1b, 'E', 0, 0x1b, 'a', 0 }, ascii("plain\n"));
        List<EscPos.Line> lines = EscPos.parse(job);
        assertEquals(2, lines.size());
        assertEquals("HI", lines.get(0).text);
        assertEquals(1, lines.get(0).align);
        assertTrue(lines.get(0).bold);
        assertTrue(lines.get(0).big);
        assertEquals(0, lines.get(1).align);
        assertFalse(lines.get(1).bold);
    }

    @Test public void readsRasterImageAndContinues() {
        byte[] job = concat(new byte[] { 0x1d, 'v', '0', 0, 2, 0, 1, 0, (byte) 0xff, 0x00 }, ascii("after\n"));
        List<EscPos.Line> lines = EscPos.parse(job);
        assertEquals(2, lines.size());
        assertEquals(2, lines.get(0).image.widthBytes);
        assertEquals("after", lines.get(1).text);
    }

    @Test public void truncatedImageDoesNotCrash() {
        byte[] job = concat(ascii("before\n"), new byte[] { 0x1d, 'v', '0', 0, 100, 0, 100, 0, 1, 2 });
        assertEquals(1, EscPos.parse(job).size());
    }

    @Test public void dropsTrailingBlankLines() {
        assertEquals(1, EscPos.parse(ascii("x\n\n\n")).size());
    }

    // ---- bill details ----

    @Test public void readsFinalBill() {
        BillInfo info = BillInfo.from(EscPos.parse(bill("", "VAS/2627/00711")));
        assertEquals(BillInfo.Kind.FINAL, info.kind);
        assertEquals("VAS/2627/00711", info.number);
        assertEquals(116.0, info.total, 0.001);
        assertEquals("Asha", info.guest);
    }

    @Test public void previewHasNoNumber() {
        BillInfo info = BillInfo.from(EscPos.parse(bill("** PREVIEW - NOT SAVED **\n", "DRAFT")));
        assertEquals(BillInfo.Kind.PREVIEW, info.kind);
        assertNull(info.number);
    }

    @Test public void testPageStaysOutOfHistory() {
        assertEquals(BillInfo.Kind.TEST, BillInfo.from(EscPos.parse(EscPos.testPage("now"))).kind);
    }

    // ---- duplicate copy ----

    @Test public void duplicateMarkIsTheFirstLineAndBillIsUnchanged() {
        byte[] job = bill("", "VAS/1");
        List<EscPos.Line> lines = EscPos.parse(EscPos.markDuplicate(job));
        assertEquals(EscPos.DUPLICATE_MARK, lines.get(0).text);
        assertEquals(1, lines.get(0).align);
        assertTrue(lines.get(0).bold);
        assertEquals("VASAMO", lines.get(1).text);
        assertEquals("VAS/1", BillInfo.from(lines).number);
    }

    // ---- framing ----

    private static byte[] frame(int flag, String data) {
        return concat(new byte[] { (byte) flag }, ascii(data));
    }

    @Test public void joinsFramesIntoOneJob() {
        JobAssembler a = new JobAssembler();
        assertNull(a.frame("pc", frame(0, "ab")).job);
        assertArrayEquals(ascii("abcd"), a.frame("pc", frame(1, "cd")).job);
    }

    @Test public void disconnectDiscardsHalfABill() {
        JobAssembler a = new JobAssembler();
        a.frame("pc", frame(0, "half"));
        a.abort("pc");
        assertArrayEquals(ascii("new"), a.frame("pc", frame(1, "new")).job);
    }

    @Test public void computersDoNotMix() {
        JobAssembler a = new JobAssembler();
        a.frame("one", frame(0, "1"));
        a.frame("two", frame(0, "2"));
        assertArrayEquals(ascii("1x"), a.frame("one", frame(1, "x")).job);
        assertArrayEquals(ascii("2y"), a.frame("two", frame(1, "y")).job);
    }

    @Test public void oversizedJobIsRejectedOnce() {
        JobAssembler a = new JobAssembler();
        byte[] big = new byte[JobAssembler.MAX_JOB + 2];
        assertNull(a.frame("pc", big).job); // flag 0
        assertFalse(a.frame("pc", frame(0, "more")).tooLarge);
        JobAssembler.Result end = a.frame("pc", frame(1, "end"));
        assertTrue(end.tooLarge);
        assertNull(end.job);
        assertArrayEquals(ascii("ok"), a.frame("pc", frame(1, "ok")).job);
    }

    // ---- printer connection ----

    private static final class FakeChannel implements PrinterLink.Channel {
        final ByteArrayOutputStream written = new ByteArrayOutputStream();
        int failOnWrite = -1;
        int writes;
        boolean closed;

        @Override public OutputStream output() {
            return new OutputStream() {
                @Override public void write(int b) { written.write(b); }
                @Override public void write(byte[] b, int off, int len) throws IOException {
                    if (writes++ == failOnWrite) throw new IOException("broken");
                    written.write(b, off, len);
                }
            };
        }
        @Override public void close() { closed = true; }
    }

    @Test public void staleConnectionRetriesOnlyTheFirstWrite() throws IOException {
        FakeChannel stale = new FakeChannel();
        FakeChannel fresh = new FakeChannel();
        FakeChannel[] queue = { stale, fresh };
        int[] next = { 0 };
        PrinterLink link = new PrinterLink(() -> queue[next[0]++]);
        link.print(new byte[10]); // opens "stale" and leaves it open
        stale.failOnWrite = stale.writes;
        byte[] job = new byte[PrinterLink.CHUNK * 2];
        link.print(job);
        assertTrue(stale.closed);
        assertEquals(job.length, fresh.written.size());
    }

    @Test public void failureMidJobIsNeverRetried() {
        FakeChannel channel = new FakeChannel();
        channel.failOnWrite = 1;
        int[] connects = { 0 };
        PrinterLink link = new PrinterLink(() -> { connects[0]++; return channel; });
        try {
            link.print(new byte[PrinterLink.CHUNK * 3]);
            fail("expected a failure");
        } catch (IOException expected) {
            assertEquals(1, connects[0]);
            assertEquals(PrinterLink.CHUNK, channel.written.size());
            assertTrue(channel.closed);
        }
    }

    // ---- finished or failed ----

    @Test public void doneOnlyAfterPrintingThenIdle() throws InterruptedException {
        PrinterWatcher w = new PrinterWatcher(5);
        w.begin();
        w.onState(PrinterWatcher.STATE_IDLE); // left over from before this job
        assertEquals(PrinterWatcher.Outcome.UNCONFIRMED, w.await(20));
        w.begin();
        w.onState(PrinterWatcher.STATE_PRINTING);
        w.onState(PrinterWatcher.STATE_IDLE);
        assertEquals(PrinterWatcher.Outcome.DONE, w.await(1000));
    }

    @Test public void noPaperWinsOverIdle() throws InterruptedException {
        PrinterWatcher w = new PrinterWatcher(5);
        w.begin();
        w.onState(PrinterWatcher.STATE_PRINTING);
        w.onState(PrinterWatcher.STATE_NO_PAPER);
        w.onState(PrinterWatcher.STATE_IDLE);
        assertEquals(PrinterWatcher.Outcome.NO_PAPER, w.await(1000));
    }

    @Test public void overheatIsReported() throws InterruptedException {
        PrinterWatcher w = new PrinterWatcher(5);
        w.begin();
        w.onTooHot();
        assertEquals(PrinterWatcher.Outcome.TOO_HOT, w.await(1000));
    }

    @Test public void measuresHowLongThePaperMoved() throws InterruptedException {
        PrinterWatcher w = new PrinterWatcher(5);
        w.begin();
        assertEquals(-1, w.printDurationMs());
        w.onState(PrinterWatcher.STATE_PRINTING);
        Thread.sleep(30);
        w.onState(PrinterWatcher.STATE_IDLE);
        assertTrue(w.printDurationMs() >= 25);
    }

    @Test public void paperLinesCountsBigLinesAndImages() {
        byte[] job = concat(ascii("a\n"), new byte[] { 0x1d, '!', 0x11 }, ascii("BIG\n"),
                new byte[] { 0x1d, 'v', '0', 0, 1, 0, 60, 0 }, new byte[60]);
        assertEquals(1 + 2 + 2, EscPos.paperLines(EscPos.parse(job)), 0.001);
    }

    @Test public void printingAgainResetsTheIdleWait() throws InterruptedException {
        PrinterWatcher w = new PrinterWatcher(50);
        w.begin();
        w.onState(PrinterWatcher.STATE_PRINTING);
        w.onState(PrinterWatcher.STATE_IDLE);
        w.onState(PrinterWatcher.STATE_PRINTING);
        assertEquals(PrinterWatcher.Outcome.UNCONFIRMED, w.await(120));
    }
}
