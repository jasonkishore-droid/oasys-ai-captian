// "Call waiter" (F6): a table asks for a person, by the tablet's button or by voice
// (the call_waiter tool), and the staff screen (KDS, floor view) shows the alert until a
// waiter acknowledges it and then marks it done.
//
// Like orders.js, each handler takes the query or body and returns { status, body }.
// It only needs the tabs database, so it works without the Stock Management database.
//
//   POST /api/oasys/waiter/call   { table_no, reason?, note?, session_id?, source? }  -> 201 new, 200 repeated
//   GET  /api/oasys/waiter?table_no=                     the table's active call (or null), for the tablet
//   POST /api/oasys/waiter/cancel { id } | { table_no }  the guest no longer needs it
//   GET  /api/oasys/waiter/calls                         every active call, oldest first, for the staff screen
//   POST /api/oasys/waiter/ack    { id, by? }            a waiter is on the way
//   POST /api/oasys/waiter/done   { id }                 dealt with
import { InventoryError } from './store.js'

export const WAITER_REASONS = ['help', 'water', 'bill', 'cutlery', 'clean', 'other']
export const WAITER_NOTE_MAX = 120

const bad = (msg) => {
  throw new InventoryError(400, msg)
}
const text = (v, max, field) => {
  if (v === undefined || v === null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  if (s.length > max) bad(`${field}: at most ${max} characters`)
  return s || null
}
const idOf = (v) => {
  const id = Number(v)
  if (!(Number.isInteger(id) && id > 0)) bad('id is required: a positive whole number')
  return id
}

export function parseWaiterCall(b = {}) {
  const table_no = text(b.table_no, 20, 'table_no') || bad('table_no is required: set the table number on the tablet')
  const reason = b.reason === undefined || b.reason === null || b.reason === '' ? 'help' : String(b.reason).toLowerCase()
  if (!WAITER_REASONS.includes(reason)) bad(`reason: must be one of ${WAITER_REASONS.join(', ')}`)
  const source = b.source === undefined || b.source === null ? 'button' : String(b.source)
  if (!['button', 'voice'].includes(source)) bad('source: button or voice')
  const session_id = b.session_id === undefined || b.session_id === null ? null : Number(b.session_id)
  if (session_id !== null && !(Number.isInteger(session_id) && session_id > 0)) bad('session_id: must be a positive whole number')
  return { table_no, reason, note: text(b.note, WAITER_NOTE_MAX, 'note'), source, session_id }
}

// what the tablet and the staff screen see
export const callView = (c) =>
  c && {
    id: c.id, table_no: c.table_no, session_id: c.session_id, reason: c.reason, note: c.note, source: c.source,
    status: c.status, repeats: c.repeats, created_at: c.created_at, updated_at: c.updated_at,
    acknowledged_at: c.acknowledged_at, acknowledged_by: c.acknowledged_by, closed_at: c.closed_at,
  }

export function waiterApi(tabs) {
  const ok = (body, status = 200) => ({ status, body })
  const set = (body, status) => ok({ ok: true, call: callView(tabs.setCallStatus(idOf(body.id), status, text(body.by, 40, 'by'))) })

  return {
    call(body = {}) {
      const b = parseWaiterCall(body)
      // tie the call to the table's open tab, so the staff screen can show what they have ordered
      const session_id = b.session_id ?? tabs.openFor(b.table_no)?.id ?? null
      const { call, repeated } = tabs.callWaiter({ ...b, session_id })
      return ok({ ok: true, repeated, call: callView(call) }, repeated ? 200 : 201)
    },

    status(query = {}) {
      const table_no = text(query.table_no, 20, 'table_no') || bad('table_no is required')
      return ok({ ok: true, call: callView(tabs.activeCallFor(table_no)) })
    },

    cancel(body = {}) {
      if (body.id === undefined || body.id === null) {
        const table_no = text(body.table_no, 20, 'table_no') || bad('id or table_no is required')
        const c = tabs.activeCallFor(table_no)
        return ok({ ok: true, call: c ? callView(tabs.setCallStatus(c.id, 'cancelled')) : null })
      }
      return set(body, 'cancelled')
    },

    active: () => ok({ ok: true, server_time: new Date().toISOString(), calls: tabs.activeCalls().map(callView) }),
    ack: (body = {}) => set(body, 'acknowledged'),
    done: (body = {}) => set(body, 'done'),
  }
}
