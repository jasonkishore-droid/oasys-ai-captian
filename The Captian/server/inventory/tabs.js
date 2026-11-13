// Open tabs: a table's dining session, kept open while the guests eat.
//
// Each time the guests order (starters, then mains, then dessert, then tea) the items are added
// to the session as a new round and go to the kitchen feed straight away. Nothing is billed or
// taken out of stock until the tab is closed: then one bill is made for everything, in the
// Stock Management database, and paid in one go.
//
// The tabs live in The Captain's own database (data/tabs.sqlite3), not the till's, so the
// till's schema is untouched. A session is either open, closed (billed) or void (closed with
// nothing on it).
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { InventoryError } from './store.js'

export const KITCHEN_STAGES = ['new', 'preparing', 'ready', 'served']

export function openTabs(file) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_no TEXT,
      customer TEXT,
      status TEXT NOT NULL DEFAULT 'open',           -- open | closed | void
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      payment_mode TEXT,
      bill_id INTEGER,
      bill_no TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_status ON sessions (status);
    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions (id),
      round_no INTEGER NOT NULL,
      items TEXT NOT NULL,                            -- JSON: [{ dish_id, name, diet, quantity, unit_price, line_total }]
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rounds_session ON rounds (session_id);
  `)
  // a special request for the whole round ("serve the starters first"); added to older databases too.
  // Requests for one dish ride on its line in items: { ..., note: 'less oil' }.
  if (!db.prepare('PRAGMA table_info(rounds)').all().some((c) => c.name === 'note')) db.exec('ALTER TABLE rounds ADD COLUMN note TEXT')
  // the kitchen's view of a round: new (just in) -> preparing -> ready -> served
  if (!db.prepare('PRAGMA table_info(rounds)').all().some((c) => c.name === 'kitchen_status')) {
    db.exec("ALTER TABLE rounds ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'new'")
    db.exec('ALTER TABLE rounds ADD COLUMN ready_at TEXT')
  }
  // "Call waiter" alerts from the tables (see waiter.js). A table has at most one active call:
  // open (waiting) or acknowledged (a waiter is on the way). Calling again only bumps `repeats`.
  db.exec(`
    CREATE TABLE IF NOT EXISTS waiter_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_no TEXT NOT NULL,
      session_id INTEGER,
      reason TEXT NOT NULL DEFAULT 'help',            -- help | water | bill | cutlery | clean | other
      note TEXT,
      source TEXT NOT NULL DEFAULT 'button',          -- button | voice
      status TEXT NOT NULL DEFAULT 'open',            -- open | acknowledged | done | cancelled
      repeats INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS waiter_calls_active ON waiter_calls (status, table_no);
  `)
  // Feedback after payment (see feedback.js): one row per bill, updated if the guest rates again
  // (e.g. taps the stars, then adds a comment by voice). No guest name or face is stored with it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no TEXT NOT NULL UNIQUE,
      session_id INTEGER,
      table_no TEXT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      liked TEXT NOT NULL DEFAULT '[]',              -- JSON: ['food', 'service', ...]
      improve TEXT NOT NULL DEFAULT '[]',
      comment TEXT,
      source TEXT NOT NULL DEFAULT 'tap',             -- tap | voice
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const get = (sql, ...p) => db.prepare(sql).get(...p) ?? null
  const all = (sql, ...p) => db.prepare(sql).all(...p)
  const run = (sql, ...p) => db.prepare(sql).run(...p)
  const now = () => new Date().toISOString()

  const roundsOf = (id) =>
    all('SELECT id, round_no, items, note, created_at FROM rounds WHERE session_id = ? ORDER BY round_no', id).map((r) => ({
      id: r.id, round_no: r.round_no, created_at: r.created_at, items: JSON.parse(r.items), ...(r.note && { kitchen_note: r.note }),
    }))

  function session(id) {
    const s = get('SELECT * FROM sessions WHERE id = ?', Number(id) || 0)
    return s ? { ...s, rounds: roundsOf(s.id) } : null
  }

  // the open session for a table, if any (a table has at most one open tab)
  function openFor(tableNo) {
    const s = tableNo ? get("SELECT id FROM sessions WHERE status = 'open' AND table_no = ? ORDER BY id DESC LIMIT 1", tableNo) : null
    return s ? session(s.id) : null
  }

  function open({ table_no = null, customer = null } = {}) {
    const existing = openFor(table_no)
    if (existing) return existing
    const { id } = get("INSERT INTO sessions (table_no, customer, status, opened_at) VALUES (?, ?, 'open', ?) RETURNING id", table_no, customer, now())
    return session(id)
  }

  function addRound(id, items, note = null) {
    const s = session(id)
    if (!s) throw new InventoryError(404, 'Tab not found')
    if (s.status !== 'open') throw new InventoryError(409, `This tab is already ${s.status === 'closed' ? 'closed and billed' : 'closed'}`)
    const n = (s.rounds.at(-1)?.round_no || 0) + 1
    run('INSERT INTO rounds (session_id, round_no, items, note, created_at) VALUES (?, ?, ?, ?, ?)', s.id, n, JSON.stringify(items), note || null, now())
    return session(s.id)
  }

  function close(id, { payment_mode, bill_id, bill_no }) {
    run("UPDATE sessions SET status = 'closed', closed_at = ?, payment_mode = ?, bill_id = ?, bill_no = ? WHERE id = ? AND status = 'open'",
      now(), payment_mode, bill_id, bill_no, id)
    return session(id)
  }

  function voidSession(id) {
    run("UPDATE sessions SET status = 'void', closed_at = ? WHERE id = ? AND status = 'open'", now(), id)
    return session(id)
  }

  // dish quantities on every open tab: ordered and cooked, but not out of stock until the tab closes
  function reserved() {
    const out = new Map()
    for (const r of all("SELECT r.items FROM rounds r JOIN sessions s ON s.id = r.session_id WHERE s.status = 'open'")) {
      for (const i of JSON.parse(r.items)) out.set(i.dish_id, (out.get(i.dish_id) || 0) + i.quantity)
    }
    return out
  }

  // the kitchen feed (each round is a kitchen ticket): rounds after an id, with their table
  // and the guests' special requests, per dish (note) and for the whole round (kitchen_note)
  function roundsSince(sinceId) {
    const rows = all(
      `SELECT r.id, r.session_id, r.round_no, r.items, r.note, r.created_at, s.table_no, s.customer FROM rounds r
       JOIN sessions s ON s.id = r.session_id WHERE r.id > ? ORDER BY r.id LIMIT 50`,
      sinceId
    )
    return {
      rounds: rows.map(({ note, ...r }) => ({
        ...r,
        kitchen_note: note || null,
        items: JSON.parse(r.items).map(({ dish_id, name, diet, quantity, note }) => ({ dish_id, name, diet, quantity, note: note || null })),
      })),
      last_id: rows.length ? rows.at(-1).id : sinceId,
    }
  }

  // the Kitchen Display: tickets from the last 12 hours that are still cooking, plus those ready in the last 30 minutes and those served in the last 3 hours
  function board() {
    const cut = (ms) => new Date(Date.now() - ms).toISOString()
    const rows = all(
      `SELECT r.id, r.session_id, r.round_no, r.items, r.note, r.created_at, r.kitchen_status AS status, r.ready_at, s.table_no, s.customer
       FROM rounds r JOIN sessions s ON s.id = r.session_id
       WHERE s.status != 'void' AND r.created_at > ? AND (r.kitchen_status IN ('new', 'preparing') OR (r.kitchen_status = 'ready' AND r.ready_at > ?) OR (r.kitchen_status = 'served' AND r.ready_at > ?)) ORDER BY r.id`,
      cut(12 * 3600e3), cut(30 * 60e3), cut(3 * 3600e3)
    )
    return {
      tickets: rows.map(({ note, items, ...r }) => ({
        ...r,
        kitchen_note: note || null,
        items: JSON.parse(items).map(({ dish_id, name, diet, quantity, note }) => ({ dish_id, name, diet, quantity, note: note || null })),
      })),
    }
  }

  function setKitchenStatus(roundId, status) {
    if (!KITCHEN_STAGES.includes(status)) throw new InventoryError(400, `status must be one of: ${KITCHEN_STAGES.join(', ')}`)
    // the time it became ready is kept when it is served (it is hidden then), and cleared if it goes back to cooking
    const readyAt = status === 'ready' ? now() : status === 'served' ? get('SELECT ready_at FROM rounds WHERE id = ?', roundId)?.ready_at || now() : null
    const r = run('UPDATE rounds SET kitchen_status = ?, ready_at = ? WHERE id = ?', status, readyAt, roundId)
    if (!r.changes) throw new InventoryError(404, 'Ticket not found')
  }

  // ---- waiter calls ----
  const ACTIVE = "status IN ('open', 'acknowledged')"
  const call = (id) => get('SELECT * FROM waiter_calls WHERE id = ?', Number(id) || 0)
  const activeCallFor = (tableNo) => get(`SELECT * FROM waiter_calls WHERE ${ACTIVE} AND table_no = ? ORDER BY id DESC LIMIT 1`, tableNo)

  // a new call, or the table's active one again (repeats + 1, reason and note updated if given)
  function callWaiter({ table_no, session_id = null, reason = 'help', note = null, source = 'button' }) {
    const t = now()
    const existing = activeCallFor(table_no)
    if (existing) {
      // a plain "help" again keeps the more specific reason ("water") already on the call
      run("UPDATE waiter_calls SET repeats = repeats + 1, reason = CASE WHEN ? = 'help' THEN reason ELSE ? END, note = COALESCE(?, note), updated_at = ? WHERE id = ?",
        reason, reason, note, t, existing.id)
      return { call: call(existing.id), repeated: true }
    }
    const { id } = get(
      `INSERT INTO waiter_calls (table_no, session_id, reason, note, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?) RETURNING id`,
      table_no, session_id, reason, note, source, t, t
    )
    return { call: call(id), repeated: false }
  }

  // open -> acknowledged -> done; open or acknowledged -> cancelled (the guest no longer needs it)
  function setCallStatus(id, status, by = null) {
    const c = call(id)
    if (!c) throw new InventoryError(404, 'Waiter call not found')
    if (c.status === status) return c
    const allowed = { acknowledged: ['open'], done: ['open', 'acknowledged'], cancelled: ['open', 'acknowledged'] }[status]
    if (!allowed?.includes(c.status)) throw new InventoryError(409, `This call is already ${c.status}`)
    const t = now()
    if (status === 'acknowledged') run("UPDATE waiter_calls SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ?", t, by, t, c.id)
    else run('UPDATE waiter_calls SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?', status, t, t, c.id)
    return call(c.id)
  }

  // for the staff screen (KDS / floor view): every active call, oldest first
  const activeCalls = () => all(`SELECT * FROM waiter_calls WHERE ${ACTIVE} ORDER BY id`)

  // ---- feedback ----
  const feedbackRow = (r) => r && { ...r, liked: JSON.parse(r.liked), improve: JSON.parse(r.improve) }
  const sessionByBill = (billNo) => get('SELECT id, table_no FROM sessions WHERE bill_no = ?', billNo)
  const feedbackFor = (billNo) => feedbackRow(get('SELECT * FROM feedback WHERE bill_no = ?', billNo))

  // save the rating for a bill; rating again replaces it, and a comment or tags left out are kept
  function saveFeedback({ bill_no, session_id, table_no, rating, liked, improve, comment, source }) {
    const t = now()
    run(
      `INSERT INTO feedback (bill_no, session_id, table_no, rating, liked, improve, comment, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bill_no) DO UPDATE SET rating = excluded.rating,
         liked = CASE WHEN ? THEN excluded.liked ELSE liked END,
         improve = CASE WHEN ? THEN excluded.improve ELSE improve END,
         comment = COALESCE(excluded.comment, comment), source = excluded.source, updated_at = excluded.updated_at`,
      bill_no, session_id, table_no, rating, JSON.stringify(liked || []), JSON.stringify(improve || []), comment, source, t, t,
      liked ? 1 : 0, improve ? 1 : 0
    )
    return feedbackFor(bill_no)
  }

  // newest first, for the manager's dashboard (F14)
  const feedbackList = ({ sinceId = 0, limit = 100 } = {}) =>
    all('SELECT * FROM feedback WHERE id > ? ORDER BY id DESC LIMIT ?', sinceId, limit).map(feedbackRow)

  return {
    session, openFor, open, addRound, close, voidSession, reserved, roundsSince, board, setKitchenStatus,
    call, activeCallFor, callWaiter, setCallStatus, activeCalls,
    sessionByBill, feedbackFor, saveFeedback, feedbackList,
    shutdown: () => db.close(),
  }
}
