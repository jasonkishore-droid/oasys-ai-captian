package com.vasamo.print;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/** Bill history and the list of computers, stored on the terminal. */
final class Db extends SQLiteOpenHelper {
    static final int ALLOWED = 1;
    static final int BLOCKED = 2;

    static final class Bill {
        long id;
        long time;
        String number;
        BillInfo.Kind kind;
        boolean printed;
        boolean isVoid;
        double total;
        String guest;
        int reprints;
    }

    static final class Computer {
        String address;
        String name;
        int status;
    }

    private static Db instance;

    static synchronized Db get(Context context) {
        if (instance == null) instance = new Db(context.getApplicationContext());
        return instance;
    }

    private Db(Context context) {
        super(context, "vasamo.db", null, 1);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE bills (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, number TEXT, kind TEXT NOT NULL,"
                + " printed INTEGER NOT NULL, is_void INTEGER NOT NULL, total REAL NOT NULL, guest TEXT NOT NULL,"
                + " reprints INTEGER NOT NULL DEFAULT 0, job BLOB NOT NULL)");
        db.execSQL("CREATE INDEX bills_time ON bills(time)");
        db.execSQL("CREATE INDEX bills_number ON bills(number)");
        db.execSQL("CREATE TABLE computers (address TEXT PRIMARY KEY, name TEXT NOT NULL, status INTEGER NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    // ---- bills ----

    /** The printed copy of this final bill, if there is one. */
    synchronized Bill printedCopy(String number) {
        if (number == null) return null;
        try (Cursor c = getReadableDatabase().query("bills", null, "number = ? AND kind = 'FINAL' AND printed = 1",
                new String[] { number }, null, null, "id DESC", "1")) {
            return c.moveToFirst() ? bill(c) : null;
        }
    }

    /** Saves the original (unmarked) job. Previews get a row each; a final bill keeps one row per number. */
    synchronized long save(BillInfo info, byte[] job, boolean printed) {
        ContentValues v = new ContentValues();
        v.put("time", System.currentTimeMillis());
        v.put("number", info.number);
        v.put("kind", info.kind.name());
        v.put("printed", printed ? 1 : 0);
        v.put("is_void", info.isVoid ? 1 : 0);
        v.put("total", info.total);
        v.put("guest", info.guest);
        v.put("job", job);
        SQLiteDatabase db = getWritableDatabase();
        if (info.kind == BillInfo.Kind.FINAL && info.number != null) {
            try (Cursor c = db.query("bills", new String[] { "id", "printed", "reprints" }, "number = ? AND kind = 'FINAL'",
                    new String[] { info.number }, null, null, "id DESC", "1")) {
                if (c.moveToFirst()) {
                    long id = c.getLong(0);
                    boolean wasPrinted = c.getInt(1) == 1;
                    v.remove("time");
                    v.put("printed", wasPrinted || printed ? 1 : 0);
                    if (wasPrinted && printed) v.put("reprints", c.getInt(2) + 1);
                    db.update("bills", v, "id = ?", new String[] { String.valueOf(id) });
                    return id;
                }
            }
        }
        return db.insert("bills", null, v);
    }

    synchronized void markPrinted(long id, boolean wasReprint) {
        getWritableDatabase().execSQL("UPDATE bills SET printed = 1, reprints = reprints + ? WHERE id = ?",
                new Object[] { wasReprint ? 1 : 0, id });
    }

    synchronized byte[] job(long id) {
        try (Cursor c = getReadableDatabase().query("bills", new String[] { "job" }, "id = ?",
                new String[] { String.valueOf(id) }, null, null, null)) {
            return c.moveToFirst() ? c.getBlob(0) : null;
        }
    }

    synchronized Bill bill(long id) {
        try (Cursor c = getReadableDatabase().query("bills", null, "id = ?", new String[] { String.valueOf(id) }, null, null, null)) {
            return c.moveToFirst() ? bill(c) : null;
        }
    }

    synchronized Bill latest() {
        List<Bill> one = bills("", 1);
        return one.isEmpty() ? null : one.get(0);
    }

    synchronized List<Bill> bills(String search, int limit) {
        String where = null;
        String[] args = null;
        if (!search.trim().isEmpty()) {
            String like = "%" + search.trim().replace("%", "\\%").replace("_", "\\_") + "%";
            where = "number LIKE ? ESCAPE '\\' OR guest LIKE ? ESCAPE '\\'";
            args = new String[] { like, like };
        }
        List<Bill> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query("bills", null, where, args, null, null, "time DESC, id DESC", String.valueOf(limit))) {
            while (c.moveToNext()) out.add(bill(c));
        }
        return out;
    }

    synchronized int printedToday() {
        Calendar day = Calendar.getInstance();
        day.set(Calendar.HOUR_OF_DAY, 0);
        day.set(Calendar.MINUTE, 0);
        day.set(Calendar.SECOND, 0);
        day.set(Calendar.MILLISECOND, 0);
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM bills WHERE printed = 1 AND kind = 'FINAL' AND time >= ?",
                new String[] { String.valueOf(day.getTimeInMillis()) })) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    synchronized void purgeOlderThan(int days) {
        long cutoff = System.currentTimeMillis() - days * 24L * 60 * 60 * 1000;
        getWritableDatabase().delete("bills", "time < ?", new String[] { String.valueOf(cutoff) });
    }

    private static Bill bill(Cursor c) {
        Bill b = new Bill();
        b.id = c.getLong(c.getColumnIndexOrThrow("id"));
        b.time = c.getLong(c.getColumnIndexOrThrow("time"));
        b.number = c.getString(c.getColumnIndexOrThrow("number"));
        b.kind = BillInfo.Kind.valueOf(c.getString(c.getColumnIndexOrThrow("kind")));
        b.printed = c.getInt(c.getColumnIndexOrThrow("printed")) == 1;
        b.isVoid = c.getInt(c.getColumnIndexOrThrow("is_void")) == 1;
        b.total = c.getDouble(c.getColumnIndexOrThrow("total"));
        b.guest = c.getString(c.getColumnIndexOrThrow("guest"));
        b.reprints = c.getInt(c.getColumnIndexOrThrow("reprints"));
        return b;
    }

    // ---- computers ----

    /** ALLOWED, BLOCKED, or 0 for a computer not seen before. */
    synchronized int computerStatus(String address) {
        try (Cursor c = getReadableDatabase().query("computers", new String[] { "status" }, "address = ?",
                new String[] { address }, null, null, null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    synchronized void setComputer(String address, String name, int status) {
        ContentValues v = new ContentValues();
        v.put("address", address);
        v.put("name", name);
        v.put("status", status);
        getWritableDatabase().insertWithOnConflict("computers", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }

    synchronized void forgetComputer(String address) {
        getWritableDatabase().delete("computers", "address = ?", new String[] { address });
    }

    synchronized List<Computer> computers() {
        List<Computer> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query("computers", null, null, null, null, null, "status, name")) {
            while (c.moveToNext()) {
                Computer k = new Computer();
                k.address = c.getString(c.getColumnIndexOrThrow("address"));
                k.name = c.getString(c.getColumnIndexOrThrow("name"));
                k.status = c.getInt(c.getColumnIndexOrThrow("status"));
                out.add(k);
            }
        }
        return out;
    }

    synchronized String nextComputerName() {
        return "Computer " + (computers().size() + 1);
    }
}
