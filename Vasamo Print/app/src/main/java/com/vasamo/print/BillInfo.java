package com.vasamo.print;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** What the history needs to know about a job, read from its printed text. */
final class BillInfo {
    enum Kind { FINAL, PREVIEW, TEST }

    private static final Pattern TOTAL = Pattern.compile("^TOTAL\\s+(?:Rs\\s*)?([0-9]+(?:\\.[0-9]+)?)");

    final Kind kind;
    final String number; // null when the bill has none yet
    final double total;
    final String guest;
    final boolean isVoid;

    private BillInfo(Kind kind, String number, double total, String guest, boolean isVoid) {
        this.kind = kind;
        this.number = number;
        this.total = total;
        this.guest = guest;
        this.isVoid = isVoid;
    }

    static BillInfo from(List<EscPos.Line> lines) {
        Kind kind = Kind.FINAL;
        String number = null;
        String guest = "";
        double total = 0;
        boolean isVoid = false;
        boolean sawInvoice = false;
        for (EscPos.Line l : lines) {
            String t = l.text.trim();
            if (t.startsWith("** PREVIEW")) kind = Kind.PREVIEW;
            else if (t.equals("Test page OK")) kind = Kind.TEST;
            else if (t.equals("*** VOID ***")) isVoid = true;
            else if (t.equals("TAX INVOICE")) sawInvoice = true;
            else if (t.startsWith("Bill No")) {
                String value = t.substring("Bill No".length()).trim();
                if (!value.isEmpty() && !value.equals("DRAFT")) number = value;
            } else if (t.startsWith("Guest ")) {
                guest = t.substring("Guest".length()).trim();
            } else {
                Matcher m = TOTAL.matcher(t);
                if (m.find()) total = Double.parseDouble(m.group(1));
            }
        }
        if (kind == Kind.FINAL && !sawInvoice) kind = Kind.TEST; // anything that is not a bill stays out of the history
        return new BillInfo(kind, number, total, guest, isVoid);
    }
}
