// The ordering API Greeny uses, ported from Stock Management (server/src/routes/integrations.js).
// Each handler takes the request's query or body and returns { status, body }, so the HTTP
// layer (server/oasysApi.js) stays thin and these can be tested without a server.
import { round2, computeTotals } from './billing.js'
import { EMAIL_RE, sendBillEmail } from './email.js'
import { InventoryError } from './store.js'

// ---- forgiving name matching: "two masala dosas", "chicken briyani", "filter kaapi" ----
const norm = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const ALIASES = { briyani: 'biryani', biriyani: 'biryani', dosai: 'dosa', thosai: 'dosa', kaapi: 'coffee', kapi: 'coffee', parota: 'parotta', porotta: 'parotta', uttapam: 'uthappam', uthapam: 'uthappam', omlet: 'omelette', omelet: 'omelette' }
const stem = (w) => {
  const a = ALIASES[w] || w
  return a.length > 3 ? a.replace(/(es|s)$/, '') : a
}
const STOP = new Set(['a', 'an', 'the', 'of', 'one', 'two', 'three', 'four', 'plate', 'plates', 'please', 'some', 'and', 'with', 'pcs', 'pc', 'piece', 'pieces'])
const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)).map(stem)

export function match(query, dishes) {
  const q = tokens(query)
  if (!q.length) return { status: 'not_found' }
  const exact = dishes.filter((d) => norm(d.name) === norm(query))
  if (exact.length === 1) return { status: 'ok', dish: exact[0] }
  const scored = dishes
    .map((d) => {
      const nt = tokens(d.name)
      const hits = q.filter((t) => nt.some((n) => n === t || (t.length > 3 && (n.startsWith(t) || t.startsWith(n))))).length
      const missing = nt.length - hits // fewer unmatched words = closer ("masala dosa" beats "mysore masala dosa")
      return { dish: d, hits, score: hits * 10 - missing }
    })
    .filter((s) => s.hits === q.length || (q.length > 2 && s.hits >= q.length - 1))
    .sort((a, b) => b.score - a.score)
  if (!scored.length) return { status: 'not_found' }
  const top = scored.filter((s) => s.score === scored[0].score)
  if (top.length > 1) return { status: 'ambiguous', options: top.slice(0, 6).map((s) => s.dish.name) }
  return { status: 'ok', dish: scored[0].dish }
}

// ---- input checks (the till used zod; these are the same rules by hand) ----
const bad = (msg) => {
  throw new InventoryError(400, msg)
}
const text = (v, max, field) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (s.length > max) bad(`${field}: at most ${max} characters`)
  return s || null
}
const oneOf = (v, list, def, field) => {
  if (v === undefined || v === null || v === '') return def
  if (!list.includes(v)) bad(`${field}: must be one of ${list.join(', ')}`)
  return v
}

export const NOTE_MAX = 100
export const KITCHEN_NOTE_MAX = 200

const sourceOf = (v) => {
  const source = v === undefined || v === null ? 'ai-captain' : String(v)
  if (!/^[a-z0-9-]{2,20}$/.test(source)) bad('source: 2-20 lowercase letters, digits or dashes')
  return source
}

export function parseOrder(b = {}) {
  if (!Array.isArray(b.items) || !b.items.length) bad('items is required: [{ name, quantity }]')
  if (b.items.length > 50) bad('items: at most 50')
  const items = b.items.map((r, i) => {
    const name = text(r?.name, 120, `items.${i}.name`)
    const dishId = r?.dish_id === undefined || r?.dish_id === null ? null : Number(r.dish_id)
    if (dishId !== null && !(Number.isInteger(dishId) && dishId > 0)) bad(`items.${i}.dish_id: must be a positive whole number`)
    const quantity = r?.quantity === undefined || r?.quantity === null ? 1 : Number(r.quantity)
    if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= 50)) bad(`items.${i}.quantity: must be 1 to 50`)
    // a special request for the kitchen, e.g. "less oil", "no onion": printed on the ticket, never billed
    return { name, dish_id: dishId, quantity, note: text(r?.note, NOTE_MAX, `items.${i}.note`) }
  })
  const phone = text(b.customer_phone, 20, 'customer_phone')
  if (phone && !/^[+\d\s-]*$/.test(phone)) bad('customer_phone: digits only')
  const email = text(b.customer_email, 254, 'customer_email')
  if (email && !EMAIL_RE.test(email)) bad('customer_email: looks invalid')
  const source = sourceOf(b.source)
  return {
    items,
    table_no: text(b.table_no, 20, 'table_no'),
    customer: text(b.customer, 120, 'customer'),
    customer_phone: phone,
    customer_email: email,
    order_type: oneOf(b.order_type, ['dine_in', 'takeaway', 'delivery'], 'dine_in', 'order_type'),
    payment_mode: oneOf(b.payment_mode, ['cash', 'upi', 'card'], 'cash', 'payment_mode'),
    // a request for the whole round, e.g. "serve the starters first", "make everything mild"
    kitchen_note: text(b.kitchen_note, KITCHEN_NOTE_MAX, 'kitchen_note'),
    dry_run: b.dry_run === true,
    source,
  }
}

// ---- the endpoints ----
export function inventoryApi(store, config, tabs = null) {
  // portions left, less what is already on open tabs (eaten, but not out of stock until the tab is paid)
  const orderable = () => {
    const held = tabs ? tabs.reserved() : new Map()
    return store.listDishes().filter((d) => d.available).map((d) =>
      d.portions === null || !held.has(d.id) ? d : { ...d, portions: Math.max(0, d.portions - held.get(d.id)) })
  }
  const soldOut = (d) => d.portions === 0 && !config.billing.allowNegativeStock
  const publicDish = (d) => ({
    id: d.id, name: d.name, section: d.section, diet: d.diet, price: d.price, description: d.description,
    portions_left: d.portions, sold_out: soldOut(d),
  })
  const ok = (body, status = 200) => ({ status, body })

  const needTabs = () => tabs || bad('Tabs are not available')
  // every round's lines, added up per dish (the bill's view: special requests are dropped)
  const merge = (rounds) => {
    const m = new Map()
    for (const r of rounds) for (const { note, ...l } of r.items) {
      const cur = m.get(l.dish_id)
      if (cur) {
        cur.quantity += l.quantity
        cur.line_total = round2(cur.line_total + l.line_total)
      } else m.set(l.dish_id, { ...l })
    }
    return [...m.values()]
  }
  // a session as the app shows it: the rounds, everything added up, and the totals so far
  const tabView = (s) => {
    const lines = merge(s.rounds)
    const totals = computeTotals(lines.map((l) => l.line_total), { service_rate: config.billing.serviceRate, tax_rate: config.billing.taxRate })
    return {
      session_id: s.id, status: s.status, table_no: s.table_no, customer: s.customer, opened_at: s.opened_at, closed_at: s.closed_at,
      bill_no: s.bill_no, payment_mode: s.payment_mode, rounds: s.rounds, lines, ...totals, tax_rate: config.billing.taxRate, currency: 'INR',
    }
  }

  // match, check and price an order (or a round); returns { b, lines, extra }, or a 422 answer
  function quote(body) {
    const b = parseOrder(body)
    const dishes = orderable()
    const byId = new Map(dishes.map((d) => [d.id, d]))
    // one line per dish and special request: "2 masala dosa" and "1 masala dosa, no onion" stay apart on the ticket
    const merged = new Map()
    const perDish = new Map() // stock is checked per dish, whatever the requests
    const problems = []
    for (const r of b.items) {
      const m = r.dish_id ? (byId.has(r.dish_id) ? { status: 'ok', dish: byId.get(r.dish_id) } : { status: 'not_found' }) : match(r.name, dishes)
      if (m.status === 'not_found') {
        problems.push({ requested: r.name || r.dish_id, problem: 'not_on_menu' })
        continue
      }
      if (m.status === 'ambiguous') {
        problems.push({ requested: r.name, problem: 'ambiguous', options: m.options })
        continue
      }
      const key = `${m.dish.id}|${(r.note || '').toLowerCase()}`
      const cur = merged.get(key) // the same request in other words' case: keep it as first said
      merged.set(key, { dish: m.dish, note: cur ? cur.note : r.note, quantity: (cur?.quantity || 0) + r.quantity })
      perDish.set(m.dish.id, { dish: m.dish, quantity: (perDish.get(m.dish.id)?.quantity || 0) + r.quantity })
    }
    const short = new Set()
    for (const { dish, quantity } of perDish.values()) {
      if (!config.billing.allowNegativeStock && dish.portions !== null && quantity > dish.portions) {
        problems.push({ requested: dish.name, problem: dish.portions === 0 ? 'sold_out' : 'not_enough_stock', portions_left: dish.portions })
        short.add(dish.id)
      }
    }
    const lines = []
    for (const { dish, note, quantity } of merged.values()) {
      if (short.has(dish.id)) continue
      lines.push({
        dish_id: dish.id, name: dish.name, diet: dish.diet, quantity, unit_price: dish.price, line_total: round2(quantity * dish.price),
        ...(note && { note }),
      })
    }
    const totals = computeTotals(lines.map((l) => l.line_total), { service_rate: config.billing.serviceRate, tax_rate: config.billing.taxRate })
    const extra = { ...totals, tax_rate: config.billing.taxRate, currency: 'INR', ...(b.kitchen_note && { kitchen_note: b.kitchen_note }) }
    if (problems.length || !lines.length) return ok({ ok: false, problems, lines, ...extra }, 422)
    return { b, lines, extra }
  }


  return {
    ping: () => ok({ ok: true, restaurant: config.restaurant.name, currency: 'INR', gst_rate: config.billing.taxRate }),

    menu(query = {}) {
      const s = tokens(query.search)
      const section = norm(query.section)
      let dishes = orderable()
      if (query.diet) dishes = dishes.filter((d) => d.diet === query.diet)
      if (section) dishes = dishes.filter((d) => norm(d.section).includes(section))
      if (s.length) dishes = dishes.filter((d) => s.every((t) => tokens(d.name).some((n) => n.startsWith(t) || t.startsWith(n))))
      return ok({ currency: 'INR', gst_rate: config.billing.taxRate, dishes: dishes.map(publicDish) })
    },

    // dry_run: a quote (matched dishes, GST totals, next bill number); otherwise the bill is created
    placeOrder(body) {
      const q = quote(body)
      if (q.status) return q
      const { b, lines, extra } = q
      if (b.dry_run) return ok({ ok: true, dry_run: true, lines, ...extra, next_bill_no: store.peekNextBillNo() })
      const id = store.createBill(
        {
          // the bill has one line per dish; special requests are for the kitchen only
          items: merge([{ items: lines }]).map((l) => ({ dish_id: l.dish_id, quantity: l.quantity })),
          table_no: b.table_no, customer: b.customer, customer_phone: b.customer_phone, customer_email: b.customer_email,
          order_type: b.order_type, payment_mode: b.payment_mode,
        },
        { source: b.source }
      )
      return ok({ ok: true, bill: store.getBill(id) }, 201)
    },

    // ---- open tabs: order in rounds through the meal, pay once at the end ----
    tab(query = {}) {
      const t = needTabs()
      const s = query.session_id ? t.session(query.session_id) : t.openFor(text(query.table_no, 20, 'table_no'))
      return ok({ ok: true, tab: s ? tabView(s) : null })
    },

    // a round: checked and priced like an order, then added to the session's tab (opened if need be)
    tabAdd(body = {}) {
      const t = needTabs()
      const q = quote({ ...body, dry_run: true })
      if (q.status) return q
      const { b, lines } = q
      let s = body.session_id ? t.session(body.session_id) : null
      if (!s || s.status !== 'open') s = t.open({ table_no: b.table_no, customer: b.customer })
      s = t.addRound(s.id, lines, b.kitchen_note)
      return ok({ ok: true, round_no: s.rounds.at(-1).round_no, tab: tabView(s) }, 201)
    },

    // close the tab: one bill for every round, paid now, and the stock taken off
    tabClose(body = {}) {
      const t = needTabs()
      const s = t.session(body.session_id)
      if (!s) throw new InventoryError(404, 'Tab not found')
      if (s.status !== 'open') throw new InventoryError(409, s.status === 'closed' ? `This tab is already paid (bill ${s.bill_no})` : 'This tab is closed')
      const payment_mode = oneOf(body.payment_mode, ['cash', 'upi', 'card'], null, 'payment_mode') || bad('payment_mode is required: cash, upi or card')
      const email = text(body.customer_email, 254, 'customer_email')
      if (email && !EMAIL_RE.test(email)) bad('customer_email: looks invalid')
      const items = merge(s.rounds)
      if (!items.length) return ok({ ok: true, tab: tabView(t.voidSession(s.id)), bill: null })
      const id = store.createBill(
        {
          items: items.map((l) => ({ dish_id: l.dish_id, quantity: l.quantity })),
          table_no: s.table_no, customer: text(body.customer, 120, 'customer') || s.customer, customer_phone: null, customer_email: email,
          order_type: 'dine_in', payment_mode,
        },
        { source: sourceOf(body.source), tab: true }
      )
      const bill = store.getBill(id)
      return ok({ ok: true, bill, tab: tabView(t.close(s.id, { payment_mode, bill_id: id, bill_no: bill.bill_no })) }, 201)
    },

    // close a tab with nothing on it (or the guests left without ordering)
    tabCancel(body = {}) {
      const t = needTabs()
      const s = t.session(body.session_id)
      if (!s) throw new InventoryError(404, 'Tab not found')
      if (s.status === 'open' && s.rounds.length) throw new InventoryError(409, 'This tab has orders on it: close it with a payment instead')
      return ok({ ok: true, tab: tabView(s.status === 'open' ? t.voidSession(s.id) : s) })
    },

    // the kitchen feed for tabs: each round as it is ordered, with its table
    kitchen: (query = {}) => ok(needTabs().roundsSince(Math.max(0, Number(query.since_id) || 0))),

    // e-receipt for a placed bill, after the guest confirmed the address
    async emailReceipt(body = {}) {
      const billNo = text(body.bill_no, 16, 'bill_no') || bad('bill_no is required')
      const to = text(body.to, 254, 'to') || bad('to is required')
      const bill = store.getBillByNo(billNo)
      if (!bill) throw new InventoryError(404, 'Bill not found')
      const messageId = await sendBillEmail(config, bill, to)
      store.markEmailed(bill.id, to)
      return ok({ ok: true, to, message_id: messageId, bill_no: bill.bill_no })
    },

    // kitchen ticket feed: poll with the last id you have seen
    ordersSince: (query = {}) => ok(store.ordersSince(Math.max(0, Number(query.since_id) || 0))),
  }
}
