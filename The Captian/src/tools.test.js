import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolRunner } from './tools.js'

function setup(over = {}) {
  const calls = { settings: [], emotion: [], greet: [], timers: [] }
  const ctx = {
    current: {
      users: () => [],
      onCamera: () => 'Jason',
      speaker: () => '',
      strangerOnCamera: () => false,
      state: () => 'awake',
      policy: () => null,
      setSetting: (k, v) => calls.settings.push([k, v]),
      showEmotion: (m, s) => calls.emotion.push([m, s]),
      setGreet: (on) => calls.greet.push(on),
      timers: {
        add: (t) => (calls.timers.push(t), { id: 'x', label: t.label || 'timer' }),
        cancel: (l) => (l === 'tea' ? 1 : 0),
      },
      ...over,
    },
  }
  return { run: createToolRunner(ctx), calls }
}

afterEach(() => vi.unstubAllGlobals())

describe('tools', () => {
  it('set_camera needs a boolean and sets cameraOn', async () => {
    const { run, calls } = setup()
    expect((await run('set_camera', {})).ok).toBe(false)
    expect(await run('set_camera', { on: false })).toMatchObject({ ok: true, camera: 'off' })
    expect(calls.settings).toEqual([['cameraOn', false]])
  })

  it('show_emotion validates and maps neutral to idle', async () => {
    const { run, calls } = setup()
    expect((await run('show_emotion', { emotion: 'angry' })).ok).toBe(false)
    expect((await run('show_emotion', { emotion: 'Neutral', seconds: 500 })).seconds).toBe(60)
    expect(calls.emotion).toEqual([['idle', 60]])
    await run('show_emotion', { emotion: 'happy' })
    expect(calls.emotion[1]).toEqual(['happy', 6])
  })

  it('greet_on_arrival defaults to on', async () => {
    const { run, calls } = setup()
    await run('greet_on_arrival', {})
    await run('greet_on_arrival', { enabled: false })
    expect(calls.greet).toEqual([true, false])
  })

  it('set_timer and cancel_timer', async () => {
    const { run, calls } = setup()
    expect((await run('set_timer', {})).ok).toBe(false)
    expect(await run('set_timer', { minutes: 10, label: 'tea' })).toMatchObject({ ok: true, seconds: 600 })
    expect(calls.timers[0]).toEqual({ seconds: 600, label: 'tea' })
    expect((await run('cancel_timer', { label: 'tea' })).ok).toBe(true)
    expect((await run('cancel_timer', { label: 'nope' })).ok).toBe(false)
  })

  it('remember_fact saves for the speaker, or the face on camera', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ person: 'Jason', text: 'likes tea' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { run } = setup()
    expect(await run('remember_fact', { fact: 'likes tea' })).toMatchObject({ ok: true, person: 'Jason' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ person: 'Jason', text: 'likes tea' })
    const { run: noOne } = setup({ onCamera: () => '' })
    expect((await noOne('remember_fact', { fact: 'x' })).ok).toBe(false)
  })

  it('forget_fact reports what it removed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ removed: ['likes tea'] }) })))
    const { run } = setup()
    expect(await run('forget_fact', { about: 'tea' })).toMatchObject({ ok: true, forgotten: ['likes tea'] })
  })

  it('unknown tools fail cleanly', async () => {
    const { run } = setup()
    expect((await run('nope', {})).ok).toBe(false)
  })
})

// Special requests for the kitchen ("less oil"), against a small stand-in for /api/oasys
describe('special requests', () => {
  const MENU = { 'masala dosa': { dish_id: 1, name: 'Masala Dosa', unit_price: 90 }, 'filter coffee': { dish_id: 2, name: 'Filter Coffee', unit_price: 30 } }
  const byId = Object.fromEntries(Object.values(MENU).map((d) => [d.dish_id, d]))
  function ordering() {
    const sent = []
    const shown = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const path = url.replace('/api/oasys/', '')
      const body = opts.body ? JSON.parse(opts.body) : null
      const reply = (status, b) => ({ status, json: async () => b })
      if (path.startsWith('tab?')) return reply(200, { tab: null })
      if (path === 'orders') {
        // like the server: one line per dish and request
        const m = new Map()
        for (const i of body.items) {
          const d = i.dish_id ? byId[i.dish_id] : MENU[i.name.toLowerCase()]
          const key = `${d.dish_id}|${(i.note || '').toLowerCase()}`
          const cur = m.get(key)
          m.set(key, { ...d, quantity: (cur?.quantity || 0) + i.quantity, ...(i.note && { note: i.note }) })
        }
        const lines = [...m.values()].map((l) => ({ ...l, line_total: l.unit_price * l.quantity }))
        const total = lines.reduce((s, l) => s + l.line_total, 0)
        return reply(200, { ok: true, lines, subtotal: total, tax: 0, service_charge: 0, total, ...(body.kitchen_note && { kitchen_note: body.kitchen_note }) })
      }
      if (path === 'tab/add') {
        sent.push(body)
        const items = body.items.map((i) => ({ ...byId[i.dish_id], quantity: i.quantity, ...(i.note && { note: i.note }) }))
        return reply(201, { round_no: 1, tab: { session_id: 1, status: 'open', table_no: 'T1', total: 0, rounds: [{ round_no: 1, items, ...(body.kitchen_note && { kitchen_note: body.kitchen_note }) }] } })
      }
      return reply(404, { error: 'not here' })
    })
    const { run } = setup({ oasysConnected: () => true, tableNo: () => 'T1', tab: () => null, setTab: () => {}, showOrder: (o) => shown.push(o) })
    return { run, sent, shown }
  }

  it('place_order passes a dish request and a round request on to the kitchen', async () => {
    const { run, sent, shown } = ordering()
    const r = await run('place_order', {
      items: [{ name: 'masala dosa', quantity: 1 }, { name: 'masala dosa', quantity: 1, note: ' less  oil ' }],
      kitchen_note: 'serve together',
    })
    expect(r.ok).toBe(true)
    expect(r.order).toEqual(['1 x Masala Dosa at ₹90 = ₹90', '1 x Masala Dosa (less oil) at ₹90 = ₹90'])
    expect(shown.at(-1)).toMatchObject({ stage: 'pending', kitchen_note: 'serve together' })
    await run('confirm_order', { confirm: true })
    expect(sent[0].items).toEqual([{ dish_id: 1, quantity: 1 }, { dish_id: 1, quantity: 1, note: 'less oil' }])
    expect(sent[0].kitchen_note).toBe('serve together')
    expect(shown.at(-1)).toMatchObject({ stage: 'added', kitchen_note: 'serve together' })
  })

  it('add_special_request notes a dish, splits a line, or notes the whole round', async () => {
    const { run, sent } = ordering()
    // nothing waiting yet
    expect((await run('add_special_request', { request: 'less oil' })).ok).toBe(false)
    await run('place_order', { items: [{ name: 'masala dosa', quantity: 2 }, { name: 'filter coffee' }] })
    expect((await run('add_special_request', { request: '' })).ok).toBe(false)
    expect((await run('add_special_request', { request: 'less oil', item: 'biryani' })).ok).toBe(false)
    // one of the two dosas without onion
    let r = await run('add_special_request', { request: 'no onion', item: 'dosa', quantity: 1 })
    expect(r.order).toEqual(['1 x Masala Dosa', '1 x Masala Dosa (no onion)', '1 x Filter Coffee'])
    r = await run('add_special_request', { request: 'less sugar', item: 'coffee' })
    expect(r.order[2]).toBe('1 x Filter Coffee (less sugar)')
    r = await run('add_special_request', { request: 'serve together' })
    expect(r.kitchen_note).toBe('serve together')
    // adding more keeps the requests
    await run('place_order', { items: [{ name: 'filter coffee' }] })
    await run('confirm_order', { confirm: true })
    expect(sent[0].items).toEqual([
      { dish_id: 1, quantity: 1 },
      { dish_id: 1, quantity: 1, note: 'no onion' },
      { dish_id: 2, quantity: 1, note: 'less sugar' },
      { dish_id: 2, quantity: 1 },
    ])
    expect(sent[0].kitchen_note).toBe('serve together')
  })
})
