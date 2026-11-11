// Runs the inventory code against a snapshot of the real Stock Management database, so orders
// can be placed for real without touching the till's live stock or bill numbers.
// Skipped when that database is not on this machine.
// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeTotals } from './billing.js'
import { inventoryConfig } from './config.js'
import { inventoryApi, match, parseOrder } from './orders.js'
import { openStore } from './store.js'
import { openTabs } from './tabs.js'

const live = inventoryConfig({})
const haveDb = existsSync(live.dbFile)

describe('match', () => {
  const dishes = [
    { id: 1, name: 'Masala Dosa' },
    { id: 2, name: 'Mysore Masala Dosa' },
    { id: 3, name: 'Chicken Biryani' },
    { id: 4, name: 'Filter Coffee' },
  ]
  it('prefers the closest name', () => expect(match('two masala dosas', dishes).dish.id).toBe(1))
  it('understands common spellings', () => {
    expect(match('chicken briyani', dishes).dish.id).toBe(3)
    expect(match('filter kaapi', dishes).dish.id).toBe(4)
  })
  it('reports what is not on the menu', () => expect(match('pizza', dishes).status).toBe('not_found'))
})

describe('parseOrder', () => {
  it('fills in defaults', () => {
    const o = parseOrder({ items: [{ name: 'Masala Dosa' }] })
    expect(o).toMatchObject({ order_type: 'dine_in', payment_mode: 'cash', dry_run: false, source: 'ai-captain' })
    expect(o.items[0].quantity).toBe(1)
  })
  it('rejects bad input', () => {
    expect(() => parseOrder({})).toThrow(/items is required/)
    expect(() => parseOrder({ items: [{ name: 'x', quantity: 0 }] })).toThrow(/quantity/)
    expect(() => parseOrder({ items: [{ name: 'x' }], payment_mode: 'cheque' })).toThrow(/payment_mode/)
    expect(() => parseOrder({ items: [{ name: 'x' }], customer_email: 'nope' })).toThrow(/customer_email/)
  })
})

describe.skipIf(!haveDb)('against a copy of the Stock Management database', () => {
  let dir, store, api, config, tabs
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-test-'))
    const copy = join(dir, 'vasamo.sqlite3')
    const src = new DatabaseSync(live.dbFile, { readOnly: true })
    src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`) // a consistent snapshot, WAL included
    src.close()
    config = inventoryConfig({ INVENTORY_DB: copy, TABS_DB: join(dir, 'tabs.sqlite3') })
    store = openStore(config)
    tabs = openTabs(config.tabsFile)
    api = inventoryApi(store, config, tabs)
  })
  afterAll(() => {
    store?.close()
    tabs?.shutdown()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('answers ping with the restaurant', () => {
    const r = api.ping()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, restaurant: config.restaurant.name, currency: 'INR' })
  })

  it('lists the menu and searches it', () => {
    const all = api.menu().body.dishes
    expect(all.length).toBeGreaterThan(0)
    const name = all[0].name
    const found = api.menu({ search: name }).body.dishes
    expect(found.map((d) => d.name)).toContain(name)
  })

  it('quotes an order without saving it', () => {
    const dish = api.menu().body.dishes.find((d) => !d.sold_out)
    const r = api.placeOrder({ items: [{ name: dish.name, quantity: 2 }], dry_run: true })
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(computeTotals([dish.price * 2], { tax_rate: config.billing.taxRate, service_rate: config.billing.serviceRate }).total)
    expect(api.placeOrder({ items: [{ name: dish.name }], dry_run: true }).body.next_bill_no).toBe(r.body.next_bill_no) // nothing used up
  })

  it('places an order: numbered bill, lines, and stock taken off', () => {
    const withRecipe = store.listDishes().find((d) => d.available && d.portions !== null && d.portions > 0)
    const dish = withRecipe || api.menu().body.dishes[0]
    const expectedNo = api.placeOrder({ items: [{ dish_id: dish.id }], dry_run: true }).body.next_bill_no
    const db = new DatabaseSync(config.dbFile)
    const movesBefore = db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'sale'").get().n

    const r = api.placeOrder({ items: [{ dish_id: dish.id, quantity: 1 }], payment_mode: 'upi', table_no: 'T9' })
    expect(r.status).toBe(201)
    const bill = r.body.bill
    expect(bill).toMatchObject({ bill_no: expectedNo, status: 'paid', source: 'ai-captain', payment_mode: 'upi', table_no: 'T9' })
    expect(bill.items).toHaveLength(1)
    expect(bill.items[0]).toMatchObject({ dish_id: dish.id, quantity: 1 })

    const movesAfter = db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'sale'").get().n
    if (withRecipe) expect(movesAfter).toBeGreaterThan(movesBefore)
    expect(api.placeOrder({ items: [{ dish_id: dish.id }], dry_run: true }).body.next_bill_no).not.toBe(expectedNo)
    expect(api.ordersSince({ since_id: bill.id - 1 }).body.orders.map((o) => o.bill_no)).toContain(bill.bill_no)
    db.close()
  })

  it('keeps a tab open through the meal and bills it once at the end', () => {
    const tracked = store.listDishes().filter((d) => d.available)
    const [a, b] = [tracked[0], tracked[1] || tracked[0]]
    const db = new DatabaseSync(config.dbFile)
    const bills = () => db.prepare('SELECT COUNT(*) AS n FROM bills').get().n
    const billsBefore = bills()
    const portionsBefore = api.menu().body.dishes.find((d) => d.id === a.id).portions_left

    // starters, then mains: two rounds on one tab, nothing billed yet
    const r1 = api.tabAdd({ table_no: 'T7', items: [{ dish_id: a.id, quantity: 2 }] })
    expect(r1.status).toBe(201)
    expect(r1.body.round_no).toBe(1)
    const id = r1.body.tab.session_id
    const r2 = api.tabAdd({ session_id: id, items: [{ dish_id: b.id, quantity: 1 }] })
    expect(r2.body.round_no).toBe(2)
    expect(r2.body.tab.session_id).toBe(id)
    expect(bills()).toBe(billsBefore)
    expect(api.tab({ table_no: 'T7' }).body.tab.session_id).toBe(id)

    // what is on the tab is held back from what is left to order
    if (portionsBefore !== null) expect(api.menu().body.dishes.find((d) => d.id === a.id).portions_left).toBe(Math.max(0, portionsBefore - 2 - (b.id === a.id ? 1 : 0)))

    // the kitchen sees each round as it comes
    const feed = api.kitchen({ since_id: 0 }).body.rounds.filter((r) => r.session_id === id)
    expect(feed.map((r) => r.round_no)).toEqual([1, 2])
    expect(feed[0]).toMatchObject({ table_no: 'T7' })

    // closing needs a payment, then makes one paid bill for everything
    expect(() => api.tabClose({ session_id: id })).toThrow(/payment_mode/)
    const tab = api.tab({ session_id: id }).body.tab
    const closed = api.tabClose({ session_id: id, payment_mode: 'upi' })
    expect(closed.status).toBe(201)
    expect(closed.body.bill).toMatchObject({ status: 'paid', payment_mode: 'upi', table_no: 'T7', total: tab.total })
    expect(closed.body.bill.items.reduce((s, l) => s + l.quantity, 0)).toBe(3)
    expect(closed.body.tab).toMatchObject({ status: 'closed', bill_no: closed.body.bill.bill_no })
    expect(bills()).toBe(billsBefore + 1)
    expect(api.tab({ table_no: 'T7' }).body.tab).toBeNull()
    expect(() => api.tabClose({ session_id: id, payment_mode: 'cash' })).toThrow(/already paid/)
    // ordering again after paying starts a new session for the table
    expect(api.tabAdd({ session_id: id, table_no: 'T7', items: [{ dish_id: a.id }] }).body.tab.session_id).not.toBe(id)
    db.close()
  })

  it('cancels only an empty tab', () => {
    const dish = store.listDishes().find((d) => d.available)
    const id = api.tabAdd({ table_no: 'T8', items: [{ dish_id: dish.id }] }).body.tab.session_id
    expect(() => api.tabCancel({ session_id: id })).toThrow(/orders on it/)
    api.tabClose({ session_id: id, payment_mode: 'cash' })
  })

  it('reports dishes it cannot find', () => {
    const r = api.placeOrder({ items: [{ name: 'zzz not a real dish' }] })
    expect(r.status).toBe(422)
    expect(r.body.problems[0].problem).toBe('not_on_menu')
  })
})
