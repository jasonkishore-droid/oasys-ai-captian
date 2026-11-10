import { describePolicy, parseColor, resolveNames } from './lib/wake.js'
import { toSeconds } from './useTimers.js'

const EMOTIONS = ['neutral', 'happy', 'curious', 'surprised', 'sleepy']

async function api(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

// the person a note is about: the one named, else whoever is speaking, else who is on camera
function personFor(ctx, named) {
  const c = ctx.current
  return String(named || c.speaker() || c.onCamera() || '').trim()
}

// Downloads the current photo or saves it to the folder, as asked ('ask' or
// nothing leaves it on screen for the user to choose).
async function keepPhoto(c, how) {
  if (/^(download|browser)/i.test(how || '')) {
    c.downloadPhoto()
    return { downloaded: true }
  }
  if (/^(folder|save|disk|computer)/i.test(how || '')) {
    try {
      return { saved_to: await c.savePhoto() }
    } catch (e) {
      return { error: e.message }
    }
  }
  return { next: 'Ask whether to download it or save it to the photo folder, then call save_photo.' }
}

// The mouse tools drive this computer through /api/desktop (see
// sidecar/desktop_service.py). They only run when the user has switched on
// "Let Greeny use the mouse" in settings.
let artSent = null // the pointer design the desktop service already has

async function desktop(c, action, args = {}) {
  if (!c.desktopAllowed()) {
    c.askDesktop()
    return {
      ok: false,
      error: 'Mouse control is switched off. An "Allow" button is now on screen: tell the user to press it, and you will be told when they have.',
    }
  }
  try {
    // Greeny's pointer, drawn in the avatar's colours; sent once per design
    const art = await c.cursorArt().catch(() => null)
    const res = await fetch(`/api/desktop/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, color: c.faceColor(), ...(art && art.key !== artSent && { cursor: art }) }),
    })
    const out = await res.json().catch(() => ({ ok: false, error: `Desktop service error (${res.status})` }))
    if ('cursor_art' in out) artSent = out.cursor_art // null after a service restart: sent again next time
    delete out.cursor_art
    return out
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// The restaurant's Stock Management app, reached through server/oasysApi.js.
// Only used while "Connect to Oasys Bay" is on in settings.
const OASYS_OFF = {
  ok: false,
  error: 'Ordering is switched off. Tell the user to turn on "Connect to Oasys Bay" in Settings (Tracking tab).',
}

async function oasys(path, body) {
  try {
    const res = await fetch(`/api/oasys/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  } catch (e) {
    return { status: 0, body: { error: e.message } }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// "Jason Kishore 82 at gmail dot com" -> "jasonkishore82@gmail.com"
const normEmail = (s) =>
  String(s || '').trim().toLowerCase()
    .replace(/\s+at\s+/g, '@').replace(/\s+dot\s+/g, '.').replace(/\s+/g, '')
// for reading back: "j a s o n k i s h o r e 8 2, at gmail dot com"
const spellEmail = (e) => {
  const [user, domain = ''] = e.split('@')
  const say = (c) => ({ '.': 'dot', _: 'underscore', '-': 'dash', '+': 'plus' })[c] || c
  return `${[...user].map(say).join(' ')}, at ${domain.split('.').join(' dot ')}`
}

// The address a registered guest last had an e-receipt sent to, kept as one of their saved notes
// (so it also shows on their card and is forgotten with them). Only the latest is kept.
const EMAIL_NOTE = 'E-receipt email: '
async function savedEmail(person) {
  try {
    const notes = await api(`/api/facts?person=${encodeURIComponent(person)}`)
    const last = notes.filter((n) => n.text.startsWith(EMAIL_NOTE)).pop()
    const addr = last ? last.text.slice(EMAIL_NOTE.length).trim().toLowerCase() : ''
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : ''
  } catch {
    return '' // the notes are a convenience: ordering carries on without them
  }
}
async function rememberEmail(person, email) {
  try {
    await api('/api/facts/forget', { method: 'POST', body: JSON.stringify({ person, about: EMAIL_NOTE.trim() }) })
    await api('/api/facts', { method: 'POST', body: JSON.stringify({ person, text: EMAIL_NOTE + email }) })
  } catch (e) {
    console.warn('Could not remember the e-receipt address:', e)
  }
}

// how the guest can pay (the values are the bill's payment modes in the Stock Management app)
const PAYMENT_METHODS = {
  cash: { mode: 'cash', label: 'Cash' },
  upi: { mode: 'upi', label: 'UPI' },
  card: { mode: 'card', label: 'Card' },
  'credit card': { mode: 'card', label: 'Card' },
  'debit card': { mode: 'card', label: 'Card' },
  gpay: { mode: 'upi', label: 'UPI' },
  phonepe: { mode: 'upi', label: 'UPI' },
  paytm: { mode: 'upi', label: 'UPI' },
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

// Turns the club app's problem list into something the model can say.
function describeProblems(problems = []) {
  return problems.map((p) => {
    if (p.problem === 'ambiguous') return `"${p.requested}" could be: ${p.options.join(', ')}. Ask which one.`
    if (p.problem === 'not_on_menu') return `"${p.requested}" is not on the menu.`
    if (p.problem === 'sold_out' || p.problem === 'out_of_stock') return `${p.requested} is sold out.`
    if (p.problem === 'not_enough_stock') return `Only ${p.portions_left} portions of ${p.requested} left.`
    return `${p.requested}: ${p.problem}`
  })
}

// Runs the tools Greeny calls during a voice chat. `ctx` is a ref to the latest
// app state and actions (see App.jsx), so a tool always sees current data.
// Every handler returns a plain object that goes back to the model.
export function createToolRunner(ctx) {
  let pendingOrder = null // prepared by place_order, waiting for the guest's yes (confirm_order)
  let lastOrder = null // the order just placed, for the e-receipt
  let pendingReceipt = null // { bill_no, email } waiting for the guest to confirm the address (send_receipt)

  const handlers = {
    list_users() {
      const c = ctx.current
      const users = c.users()
      return {
        registered_users: users,
        on_camera: c.onCamera() || null,
        stranger_on_camera: c.strangerOnCamera(),
        speaking_now: c.speaker() || null,
        state: c.state(),
        wake_rule: describePolicy(c.policy()),
      }
    },

    set_wake_policy({ wake_for, any_registered, sleep_now } = {}) {
      const c = ctx.current
      const registered = c.users().map((u) => u.name)
      const { resolved, unknown } = resolveNames(wake_for, registered)
      if (!resolved.length && !any_registered) {
        return {
          ok: false,
          error: unknown.length
            ? `None of those names are registered: ${unknown.join(', ')}.`
            : 'Say who may wake me, or set any_registered.',
          registered_users: registered,
        }
      }
      const policy = { users: resolved, anyRegistered: !!any_registered }
      c.setPolicy(policy)
      const sleeping = sleep_now !== false
      if (sleeping) c.sleepSoon()
      return {
        ok: true,
        wake_rule: describePolicy(policy),
        will_wake_for: resolved,
        any_registered: !!any_registered,
        unknown_names: unknown,
        going_to_sleep: sleeping,
        note: unknown.length ? 'Tell the user those names are not registered.' : undefined,
      }
    },

    clear_wake_policy() {
      ctx.current.setPolicy(null)
      return { ok: true, wake_rule: describePolicy(null) }
    },

    go_to_sleep() {
      ctx.current.sleepSoon()
      return { ok: true, going_to_sleep: true, wake_rule: describePolicy(ctx.current.policy()) }
    },

    wake_up() {
      ctx.current.setPolicy(null)
      ctx.current.wake()
      return { ok: true, awake: true }
    },

    register_face({ name } = {}) {
      return ctx.current.registration.beginFace(name)
    },

    register_voice({ name } = {}) {
      return ctx.current.registration.beginVoice(name)
    },

    finish_voice_recording() {
      return ctx.current.registration.finishVoice()
    },

    remove_person({ name, what } = {}) {
      return ctx.current.registration.beginRemove(name, what)
    },

    confirm_pending({ confirm, name } = {}) {
      return ctx.current.registration.confirm(confirm === true, name)
    },

    set_camera({ on, facing } = {}) {
      const side = /^(rear|back|environment)$/i.test(facing || '') ? 'environment' : /^(front|user|selfie)$/i.test(facing || '') ? 'user' : null
      if (typeof on !== 'boolean' && !side) return { ok: false, error: 'Say whether the camera should be on or off, or front or rear.' }
      if (side) ctx.current.setSetting('facing', side)
      const camOn = side ? on !== false : on
      ctx.current.setSetting('cameraOn', camOn)
      return { ok: true, camera: camOn ? 'on' : 'off', ...(side && { facing: side === 'user' ? 'front' : 'rear' }) }
    },

    async take_photo({ delay_seconds, save } = {}) {
      const c = ctx.current
      if (!c.camera()) return { ok: false, error: 'The camera is off or not ready. Turn it on first (set_camera).' }
      try {
        await c.takePhoto(typeof delay_seconds === 'number' ? delay_seconds : 3)
      } catch (e) {
        return { ok: false, error: e.message }
      }
      return { ok: true, photo: 'taken and shown on screen', ...(await keepPhoto(c, save)) }
    },

    async save_photo({ where } = {}) {
      const c = ctx.current
      if (!c.hasPhoto()) return { ok: false, error: 'No photo has been taken yet. Call take_photo first.' }
      if (/^(close|discard|delete|cancel)/i.test(where || '')) {
        c.closePhoto()
        return { ok: true, closed: true }
      }
      const r = await keepPhoto(c, where)
      return r.error ? { ok: false, ...r } : { ok: true, ...r }
    },

    close_popups() {
      const closed = ctx.current.closePopups()
      return { ok: true, closed: closed.length ? closed : 'nothing was open' }
    },

    async see_screen() {
      const c = ctx.current
      const r = await desktop(c, 'screenshot')
      if (!r.ok) return r
      if (!c.showImage(r.image, r.mimeType)) return { ok: false, error: 'Voice chat is not connected.' }
      return { ok: true, screenshot: 'sent as the next image', pointer_at: { x: r.pointer[0], y: r.pointer[1] }, grid: '0-1000 on both axes' }
    },

    click_text({ text, occurrence, button, double } = {}) {
      if (!text) return { ok: false, error: 'Say which words to click.' }
      return desktop(ctx.current, 'click_text', { text: String(text), occurrence, button, double: !!double })
    },

    fill_field({ field, text, where, enter, occurrence } = {}) {
      if (!field) return { ok: false, error: 'Say which field to fill.' }
      return desktop(ctx.current, 'fill', { field: String(field), text: String(text ?? ''), where, enter: !!enter, occurrence })
    },

    search_web({ query, new_tab } = {}) {
      if (!query) return { ok: false, error: 'Say what to search for.' }
      return desktop(ctx.current, 'search', { query: String(query), new_tab: !!new_tab })
    },

    read_screen() {
      return desktop(ctx.current, 'read')
    },

    mouse_move({ x, y } = {}) {
      if (typeof x !== 'number' || typeof y !== 'number') return { ok: false, error: 'Give x and y on the 0-1000 grid.' }
      return desktop(ctx.current, 'move', { x, y })
    },

    mouse_click({ x, y, button, double } = {}) {
      const at = typeof x === 'number' && typeof y === 'number' ? { x, y } : {}
      return desktop(ctx.current, 'click', { ...at, button, double: !!double })
    },

    mouse_scroll({ direction, amount } = {}) {
      return desktop(ctx.current, 'scroll', { direction: direction === 'up' ? 'up' : 'down', amount })
    },

    type_text({ text } = {}) {
      if (!text) return { ok: false, error: 'Nothing to type.' }
      return desktop(ctx.current, 'type', { text: String(text) })
    },

    press_keys({ keys } = {}) {
      return desktop(ctx.current, 'keys', { keys: String(keys || '') })
    },

    open_tab({ url } = {}) {
      return desktop(ctx.current, 'open', { url: url ? String(url) : '' })
    },

    show_users({ show } = {}) {
      const c = ctx.current
      const open = show !== false
      c.showUsers(open)
      const names = c.users().map((u) => u.name)
      return open ? { ok: true, showing: true, people: names } : { ok: true, showing: false }
    },

    async show_user({ name, hide } = {}) {
      const c = ctx.current
      if (hide) {
        c.showUser(null)
        return { ok: true, showing: false }
      }
      const { resolved } = resolveNames([name], c.users().map((u) => u.name))
      if (!resolved.length) return { ok: false, error: `I do not know anyone called "${name || ''}". Say list_users to hear who is saved.` }
      const person = resolved[0]
      c.showUser(person)
      let facts = []
      try {
        facts = (await api(`/api/facts?person=${encodeURIComponent(person)}`)).map((f) => f.text)
      } catch { /* the card shows without notes */ }
      return { ok: true, showing: person, saved_notes: facts }
    },

    async remember_fact({ fact, person } = {}) {
      const who = personFor(ctx, person)
      if (!who) return { ok: false, error: 'I do not know who this is about. Ask the user to say the person\'s name.' }
      if (!String(fact || '').trim()) return { ok: false, error: 'What should I remember?' }
      const saved = await api('/api/facts', { method: 'POST', body: JSON.stringify({ person: who, text: fact }) })
      return { ok: true, remembered: saved.text, person: saved.person }
    },

    async forget_fact({ about, person } = {}) {
      const who = personFor(ctx, person)
      if (!who) return { ok: false, error: 'I do not know whose notes to look in. Ask the user to say the name.' }
      const { removed } = await api('/api/facts/forget', { method: 'POST', body: JSON.stringify({ person: who, about }) })
      return removed.length ? { ok: true, forgotten: removed, person: who } : { ok: false, error: `I have nothing saved about "${about}" for ${who}.` }
    },

    async list_facts({ person } = {}) {
      const who = personFor(ctx, person)
      if (!who) return { ok: false, error: 'I do not know whose notes to read. Ask the user to say the name.' }
      const facts = await api(`/api/facts?person=${encodeURIComponent(who)}`)
      return { ok: true, person: who, facts: facts.map((f) => f.text) }
    },

    show_emotion({ emotion, seconds } = {}) {
      const e = String(emotion || '').toLowerCase()
      if (!EMOTIONS.includes(e)) return { ok: false, error: `Pick one of: ${EMOTIONS.join(', ')}.` }
      const secs = Math.min(60, Math.max(1, Number(seconds) || 6))
      ctx.current.showEmotion(e === 'neutral' ? 'idle' : e, secs)
      return { ok: true, emotion: e, seconds: secs }
    },

    greet_on_arrival({ enabled } = {}) {
      const on = enabled !== false
      ctx.current.setGreet(on)
      return { ok: true, greeting: on ? 'on' : 'off', note: on ? 'I will say hello to registered people when they come back while a voice chat is running.' : undefined }
    },

    set_timer({ minutes, seconds, label } = {}) {
      const total = toSeconds({ minutes, seconds })
      if (!total) return { ok: false, error: 'Give a length between 1 second and 24 hours.' }
      const t = ctx.current.timers.add({ seconds: total, label })
      return { ok: true, label: t.label, seconds: total }
    },

    cancel_timer({ label } = {}) {
      const n = ctx.current.timers.cancel(label)
      return n ? { ok: true, cancelled: n } : { ok: false, error: label ? `No timer called "${label}".` : 'No timers are running.' }
    },

    change_colors({ eye_color, face_color } = {}) {
      const eye = eye_color ? parseColor(eye_color) : undefined
      const face = face_color ? parseColor(face_color) : undefined
      const bad = [eye_color && !eye && eye_color, face_color && !face && face_color].filter(Boolean)
      if (bad.length) return { ok: false, error: `Not a colour I know: ${bad.join(', ')}. Try a name like red or a hex code.` }
      if (!eye && !face) return { ok: false, error: 'Give an eye_color and/or a face_color.' }
      if (eye) ctx.current.setSetting('eyeColor', eye)
      if (face) ctx.current.setSetting('faceColor', face)
      return { ok: true, eye_color: eye, face_color: face }
    },

    async get_menu({ category, search } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const q = new URLSearchParams({ ...(category && { section: category }), ...(search && { search }) })
      const { status, body } = await oasys(`menu${q.size ? `?${q}` : ''}`)
      if (status !== 200) return { ok: false, error: body.error || 'Could not load the Oasys Bay menu.' }
      return {
        ok: true,
        currency: 'INR (rupees)',
        items: (body.dishes || []).filter((d) => !d.sold_out).map((d) => ({
          name: d.name, category: d.section, diet: d.diet, price: rupees(d.price),
          ...(d.portions_left != null && { portions_left: d.portions_left }),
        })),
        ...(!(body.dishes || []).some((d) => !d.sold_out) && { note: 'Nothing matches that on the menu right now.' }),
      }
    },

    async place_order({ items, table, guest_name, guest_email, payment_method } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const wanted = (Array.isArray(items) ? items : [])
        .map((i) => ({ name: String(i?.name || '').trim(), quantity: Math.max(1, Math.floor(Number(i?.quantity) || 1)) }))
        .filter((i) => i.name)
      if (!wanted.length) return { ok: false, error: 'What would they like to order?' }
      // how they pay is asked only after they confirm the order (confirm_order); kept here only if they already said it
      const pay = PAYMENT_METHODS[String(payment_method || '').trim().toLowerCase()]
      const order = {
        table_no: String(table || '').trim() || undefined,
        customer: String(guest_name || '').trim() || personFor(ctx) || undefined,
        payment_mode: pay?.mode,
      }
      // an address said up front is only remembered to suggest later; e-receipts are sent after the order, once confirmed
      const suggestedEmail = normEmail(guest_email)
      const { status, body } = await oasys('orders', { ...order, items: wanted, dry_run: true })
      if (status === 422) {
        pendingOrder = null
        ctx.current.showOrder?.({ stage: 'problem', problems: describeProblems(body.problems) })
        return {
          ok: false,
          problems: describeProblems(body.problems),
          can_order: (body.lines || []).map((l) => `${l.quantity} x ${l.name}`),
          next: 'Tell the guest about the problems and ask what they want instead, then call place_order again with the full order.',
        }
      }
      if (status !== 200) return { ok: false, error: body.error || 'Oasys Bay did not accept the order.' }
      const card = {
        lines: body.lines, table: order.table_no, payment: pay?.label,
        subtotal: body.subtotal, tax: body.tax, tax_rate: body.tax_rate, service_charge: body.service_charge, total: body.total,
      }
      pendingOrder = { ...order, items: body.lines.map((l) => ({ dish_id: l.dish_id, quantity: l.quantity })), suggestedEmail, card, at: Date.now() }
      ctx.current.showOrder?.({ stage: 'pending', ...card })
      return {
        ok: true,
        order: body.lines.map((l) => `${l.quantity} x ${l.name} at ${rupees(l.unit_price)} = ${rupees(l.line_total)}`),
        subtotal: rupees(body.subtotal),
        ...(body.tax > 0 && { tax: `${rupees(body.tax)} (${body.tax_rate}%)` }),
        ...(body.service_charge > 0 && { service_charge: rupees(body.service_charge) }),
        total: rupees(body.total),
        table: order.table_no || null,
        ...(pay && { payment: pay.label }),
        next:
          'Read back ONLY the items and quantities, e.g. "one chicken biryani and two Coca-Colas, shall I confirm that?". ' +
          'Do NOT say any price, tax or total out loud: the amounts are on the card on screen. ' +
          'Say an amount only if the guest asks for it, and then use ONLY the figures in this result. ' +
          'Ask the guest to confirm, then call confirm_order with their answer. ' +
          'Do NOT ask how they will pay yet: that is asked only after they have confirmed the order. ' +
          'Do not ask about the e-receipt yet; that comes after the order is placed.',
      }
    },

    async confirm_order({ confirm, payment_method } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      if (!pendingOrder || Date.now() - pendingOrder.at > 10 * 60_000) {
        pendingOrder = null
        return { ok: false, error: 'There is no order waiting. Call place_order first.' }
      }
      const show = (o) => ctx.current.showOrder?.(o)
      if (confirm !== true) {
        pendingOrder = null
        show({ stage: 'cancelled' })
        return { ok: true, cancelled: true }
      }
      // the guest said yes: now (and only now) ask how they will pay. The bill records it, so never assume cash.
      const pay = PAYMENT_METHODS[String(payment_method || '').trim().toLowerCase()]
      if (pay) pendingOrder.payment_mode = pay.mode
      if (!pendingOrder.payment_mode) {
        pendingOrder.at = Date.now()
        show({ stage: 'payment', ...pendingOrder.card })
        return {
          ok: false,
          placed: false,
          needs: 'payment_method',
          next:
            'The order is confirmed but NOT placed yet. Ask the guest how they will pay: cash, UPI or card ' +
            '(the card on screen has the three buttons too). Then call confirm_order again with confirm true and their answer as payment_method.',
        }
      }
      const { suggestedEmail, at, card, ...order } = pendingOrder
      pendingOrder = null
      const { status, body } = await oasys('orders', { ...order, dry_run: false, source: 'greeny' })
      if (status === 422) {
        show({ stage: 'problem', problems: describeProblems(body.problems) })
        return { ok: false, problems: describeProblems(body.problems), next: 'Stock changed. Tell the guest and offer alternatives.' }
      }
      if (status !== 201) {
        show({ stage: 'problem', problems: [body.error || 'The order could not be placed.'] })
        return { ok: false, error: body.error || 'The order could not be placed.' }
      }
      // a registered guest (recognised by face, else by voice) may have an address from last time
      const guest = ctx.current.onCamera() || ctx.current.speaker() || ''
      const knownEmail = suggestedEmail || !guest ? '' : await savedEmail(guest)
      lastOrder = { bill_no: body.bill.bill_no, total: body.bill.total, table: body.bill.table_no, at: Date.now(), guest, email: suggestedEmail || knownEmail }
      pendingReceipt = null
      show({ stage: 'placed', ...lastOrder })
      return {
        ok: true,
        placed: true,
        bill_no: body.bill.bill_no,
        total: rupees(body.bill.total),
        next:
          'Tell the guest the order is placed and give the bill number, but do not say the total unless they ask. ' +
          'Then ask whether they would like a paper receipt, an e-receipt by email, both, or neither ' +
          '(the card on screen also has a print button and a box to type the email). ' +
          'Wait for their answer. Call print_receipt (guest_asked true) ONLY if they say yes to a paper receipt; never print on your own. For an e-receipt: ' +
          (suggestedEmail ? `They mentioned ${suggestedEmail} earlier: if they want it, call set_receipt_email with it so they can confirm it. ` : '') +
          (knownEmail
            ? `${guest} had the e-receipt sent to ${knownEmail} last time. If they want an e-receipt, ask whether to send it to that same address or to a new one, ` +
              'then call set_receipt_email with the address they choose. '
            : '') +
          'If yes, call set_receipt_email with the address. Never send anything until they have confirmed the address.',
        ...(knownEmail && { email_used_last_time: knownEmail }),
      }
    },

    // Paper receipt: printed on the restaurant's Bluetooth printer, which is reached through the
    // Stock Management app's browser tab. The job is queued there; wait to hear whether it printed.
    async print_receipt({ guest_asked } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      // paper is only used when the guest asks for it: never print because the order was just placed
      if (guest_asked !== true) {
        return { ok: false, printed: false, error: 'Nothing was printed. Ask the guest whether they want a paper receipt, wait for their answer, and call print_receipt only if they say yes.' }
      }
      if (!lastOrder || Date.now() - lastOrder.at > 30 * 60_000) return { ok: false, error: 'There is no recent order to print a receipt for.' }
      const order = lastOrder
      const show = (extra) => ctx.current.showOrder?.({ stage: 'placed', ...order, email: pendingReceipt?.email || order.email || '', ...extra })
      const fail = (error) => {
        show({ error })
        return { ok: false, error, next: 'Tell the guest the paper receipt could not be printed, and offer an e-receipt instead.' }
      }
      const { status, body } = await oasys('print-receipt', { bill_no: order.bill_no })
      if (status !== 202) return fail(body.error || 'The receipt could not be sent to the printer.')
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const { body: job } = await oasys(`print-jobs/${body.job_id}`)
        if (job.status === 'printed') {
          show({ printed: true })
          return { ok: true, printed: true, bill_no: order.bill_no }
        }
        if (job.status === 'failed') return fail(job.error || 'The printer did not print the receipt.')
      }
      return fail('The printer did not answer. The Stock Management app must be open with the printer connected.')
    },

    // E-receipt step 1: take the address and ask the guest to confirm it (nothing is sent yet).
    set_receipt_email({ email } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      if (!lastOrder || Date.now() - lastOrder.at > 30 * 60_000) return { ok: false, error: 'There is no recent order to send a receipt for.' }
      const addr = normEmail(email)
      if (!EMAIL_RE.test(addr)) {
        return { ok: false, error: `"${email}" does not look like an email address. Ask for it again, or they can type it on the card.` }
      }
      pendingReceipt = { bill_no: lastOrder.bill_no, email: addr }
      ctx.current.showOrder?.({ stage: 'receipt_confirm', ...lastOrder, email: addr })
      return {
        ok: true,
        email: addr,
        spelled: spellEmail(addr),
        next: 'Spell the address back to the guest using "spelled" and ask "is that right?". ' +
          'If yes, call send_receipt with confirm true. If no, ask for it again and call set_receipt_email with the corrected address.',
      }
    },

    // E-receipt step 2: send it, only after the guest confirmed the address.
    async send_receipt({ confirm } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      if (!pendingReceipt) return { ok: false, error: 'No address is waiting for confirmation. Call set_receipt_email first.' }
      const { bill_no, email } = pendingReceipt
      const show = (o) => ctx.current.showOrder?.(o)
      if (confirm !== true) {
        pendingReceipt = null
        show({ stage: 'placed', ...lastOrder, email })
        return { ok: true, sent: false, next: 'Ask for the correct address (then call set_receipt_email), or skip the e-receipt if they do not want one.' }
      }
      const { status, body } = await oasys('orders/email', { bill_no, to: email })
      if (status !== 200) {
        show({ stage: 'placed', ...lastOrder, email, error: body.error || 'The e-receipt could not be sent.' })
        return { ok: false, error: body.error || 'The e-receipt could not be sent.' }
      }
      pendingReceipt = null
      if (lastOrder?.guest) rememberEmail(lastOrder.guest, body.to) // offered again on their next order
      show({ stage: 'receipt_sent', ...lastOrder, email: body.to })
      return { ok: true, sent: true, to: body.to, bill_no }
    },
  }

  return async function run(name, args) {
    const fn = handlers[name]
    if (!fn) return { ok: false, error: `Unknown tool: ${name}` }
    try {
      return await fn(args || {})
    } catch (e) {
      console.error(`[tool ${name}]`, e)
      return { ok: false, error: 'The tool failed.' }
    }
  }
}
