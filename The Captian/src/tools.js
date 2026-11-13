import { describePolicy, parseColor, resolveNames } from './lib/wake.js'
import { toSeconds } from './useTimers.js'
import { ALLERGY_AVOIDS, dietaryLabel, dietaryQuery, dietFrom } from './lib/dietary.js'

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
// Only used while "Connect to Vasamo" is on in settings.
const OASYS_OFF = {
  ok: false,
  error: 'Ordering is switched off. Tell the user to turn on "Connect to Vasamo" in Settings (Tracking tab) or in the tablet gear menu.',
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

// Special requests for the kitchen ("less oil", "no onion"): per dish (a line's note) or for the
// whole round (kitchen_note). Same limits as the server (server/inventory/orders.js).
const NOTE_MAX = 100
const KITCHEN_NOTE_MAX = 200
// call waiter: same reasons and limit as server/inventory/waiter.js
const WAITER_REASONS = ['help', 'water', 'bill', 'cutlery', 'clean', 'other']
const WAITER_NOTE_MAX = 120
// feedback after payment: same tags and limit as server/inventory/feedback.js
export const FEEDBACK_TAGS = ['food', 'service', 'speed', 'value', 'ambience', 'cleanliness']
const FEEDBACK_COMMENT_MAX = 500
const knownTags = (list) => (Array.isArray(list) ? [...new Set(list.map((t) => String(t).toLowerCase().trim()))].filter((t) => FEEDBACK_TAGS.includes(t)) : undefined)
const cleanNote = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
// "less oil" + "no onion" -> "less oil; no onion" (a request already there is not repeated)
const joinNotes = (a, b, max = KITCHEN_NOTE_MAX) => {
  const parts = [a, b].map((s) => cleanNote(s, max)).filter(Boolean)
  const seen = new Set()
  return parts.filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).join('; ').slice(0, max)
}
// what the server needs to re-check a round: the dish, how many, and its request
const itemsOf = (lines) => lines.map((l) => ({ dish_id: l.dish_id, quantity: l.quantity, ...(l.note && { note: l.note }) }))
// does "dosa" / "the masala dosa" name this dish ("Masala Dosa")?
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && w !== 'the')
const namesDish = (said, dish) => {
  const d = words(dish)
  const s = words(said)
  return s.length > 0 && s.every((w) => d.some((x) => x === w || x.startsWith(w) || w.startsWith(x)))
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
  let tabEmail = '' // an address the guest mentioned while ordering, suggested for the e-receipt when the tab is paid
  // The dietary filter a guest asked for ("I'm Jain", "no onion"): used by get_menu / show_menu when
  // passed, and each new round is checked against it. Cleared when the tab is paid or on request.
  let tableDiet = null // { diet, avoid }
  const passing = new Map() // dietaryQuery string -> { ids: Set, at }: the dishes that pass, cached for a minute
  async function passingIds(f) {
    const q = dietaryQuery(f).toString()
    const hit = passing.get(q)
    if (hit && Date.now() - hit.at < 60_000) return hit.ids
    const { status, body } = await oasys(`menu?${q}`)
    if (status !== 200) return null
    const ids = new Set((body.dishes || []).map((d) => d.id))
    passing.set(q, { ids, at: Date.now() })
    return ids
  }

  // the rating card after payment: what has been tapped so far, and what was saved for this bill
  let rating = null // { bill_no, stars, tags: Set, saved: stars | 0 }

  // the bill the rating is for: the tab just paid, for up to an hour
  const ratingFor = () => {
    if (!lastOrder || Date.now() - lastOrder.at > 60 * 60_000) return null
    if (rating?.bill_no !== lastOrder.bill_no) rating = { bill_no: lastOrder.bill_no, stars: 0, tags: new Set(), saved: 0 }
    return rating
  }
  const showRating = (r, error = null) =>
    ctx.current.showOrder?.({ stage: 'rating', bill_no: r.bill_no, table: lastOrder.table, rating: r.stars, tags: [...r.tags], ...(error && { error }) })

  // The table's open tab (its dining session), as the server has it. The app keeps the session id
  // (so a reload carries on with the same tab); with none, the table's open tab is looked up.
  const setTab = (t) => ctx.current.setTab?.(t && t.status === 'open' ? t : null)
  async function currentTab() {
    const known = ctx.current.tab?.()
    const table = ctx.current.tableNo?.() || ''
    const q = known?.session_id ? `session_id=${known.session_id}` : table ? `table_no=${encodeURIComponent(table)}` : ''
    if (!q) return null
    const { status, body } = await oasys(`tab?${q}`)
    if (status !== 200) return known || null
    const t = body.tab && body.tab.status === 'open' ? body.tab : null
    setTab(t)
    return t
  }
  // what the tab and payment cards show
  const tabCard = (t) => ({
    lines: t.lines, table: t.table_no, rounds: t.rounds.length,
    subtotal: t.subtotal, tax: t.tax, tax_rate: t.tax_rate, service_charge: t.service_charge, total: t.total,
  })

  const handlers = {
    // Call waiter (F6): works without "Connect to Vasamo", as it needs only the table number.
    async call_waiter({ reason, note } = {}) {
      const c = ctx.current
      const table = c.tableNo?.() || ''
      if (!table) {
        return {
          ok: false,
          error: 'This tablet has no table number set, so the staff would not know where to go.',
          next: 'Apologise and ask the guest to wave to a waiter. Staff can set the table number in the tablet\'s settings.',
        }
      }
      const r = WAITER_REASONS.includes(String(reason || '').toLowerCase()) ? String(reason).toLowerCase() : 'help'
      const { status, body } = await oasys('waiter/call', {
        table_no: table, reason: r, note: cleanNote(note, WAITER_NOTE_MAX) || undefined, session_id: c.tab?.()?.session_id, source: 'voice',
      })
      if (status !== 200 && status !== 201) return { ok: false, error: body.error || 'The waiter could not be called.', next: 'Say so and ask the guest to wave to a waiter.' }
      c.setWaiterCall?.(body.call)
      return {
        ok: true,
        table,
        already_called: body.repeated,
        waiter_on_the_way: body.call.status === 'acknowledged',
        next: body.repeated
          ? 'Say you have reminded the staff and someone will be with them shortly.'
          : 'Say a waiter has been called and will be with them shortly. Do not promise a time.',
      }
    },

    async cancel_waiter_call() {
      const c = ctx.current
      const table = c.tableNo?.() || ''
      if (!table) return { ok: false, error: 'No table number is set.' }
      const { status, body } = await oasys('waiter/cancel', { table_no: table })
      if (status !== 200) return { ok: false, error: body.error || 'The call could not be cancelled.' }
      c.setWaiterCall?.(null)
      return { ok: true, cancelled: !!body.call, next: body.call ? 'Say the waiter call is cancelled.' : 'There was no waiter call to cancel. Say so briefly.' }
    },

    // Feedback (F8), after the tab is paid. Without a rating it shows the rating card; with one it is
    // saved (rating again, or adding a comment later, updates the same bill's feedback).
    async rate_meal({ rating: stars, liked, improve, comment, via } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const r = ratingFor()
      if (!r) return { ok: false, error: 'There is no recently paid bill to rate.' }
      const note = cleanNote(comment, FEEDBACK_COMMENT_MAX)
      let n = Number(stars)
      if (!(Number.isInteger(n) && n >= 1 && n <= 5)) n = note && r.saved ? r.saved : 0 // a comment after rating keeps the stars
      if (!n) {
        showRating(r)
        return {
          ok: true,
          shown: true,
          next:
            'The rating card is on screen. In one short sentence, ask how everything was, from 1 to 5 stars (they can also tap). ' +
            'It is optional: if they would rather not, thank them and stop. When they answer, call rate_meal with the rating, ' +
            'and liked / improve if they said what was good or could be better.',
        }
      }
      const tapped = [...r.tags]
      const body = {
        bill_no: r.bill_no, rating: n, source: via === 'tap' ? 'tap' : 'voice', // via: 'tap' from the card's Submit
        // tags tapped on the card count as liked (4-5 stars) or could-be-better (1-3 stars)
        liked: knownTags(liked) ?? (n >= 4 && tapped.length ? tapped : undefined),
        improve: knownTags(improve) ?? (n <= 3 && tapped.length ? tapped : undefined),
        ...(note && { comment: note }),
      }
      const { status, body: res } = await oasys('feedback', body)
      if (status !== 200 && status !== 201) {
        const error = res.error || 'The rating could not be saved.'
        showRating(r, error)
        return { ok: false, error }
      }
      r.stars = n
      r.saved = n
      ctx.current.showOrder?.({ stage: 'rating_thanks', bill_no: r.bill_no, table: lastOrder.table, rating: n })
      return {
        ok: true,
        saved: true,
        rating: n,
        next:
          n <= 2
            ? 'Apologise sincerely in one or two sentences and ask what went wrong, if they want to say (then call rate_meal again with the same rating and their comment). ' +
              'Offer to send a manager over: if they want that, call call_waiter with reason "other" and a short note. The card has a button for it too.'
            : 'Thank them warmly in one short sentence. If they add a comment, call rate_meal again with the same rating and the comment.',
      }
    },

    // the rating card's taps (not a voice tool): pick the stars, or switch a tag on or off
    rating_pick({ rating: stars, tag } = {}) {
      const r = ratingFor()
      if (!r) return { ok: false, error: 'There is no recently paid bill to rate.' }
      if (Number.isInteger(stars) && stars >= 1 && stars <= 5) {
        // the tags change meaning across 3 and 4 stars (liked vs could be better), so start them again
        if (r.stars && (r.stars >= 4) !== (stars >= 4)) r.tags.clear()
        r.stars = stars
      }
      if (FEEDBACK_TAGS.includes(tag)) r.tags.has(tag) ? r.tags.delete(tag) : r.tags.add(tag)
      showRating(r)
      return { ok: true, rating: r.stars, tags: [...r.tags] }
    },

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

    // The menu card carousel on screen, opened at a section if one was asked for.
    async show_menu({ section, show, diet, avoid, clear_filter } = {}) {
      if (show === false) {
        ctx.current.showMenu?.(null)
        return { ok: true, showing: false }
      }
      const f = clear_filter ? null : dietFrom({ diet, avoid })
      if (clear_filter) tableDiet = null
      if (f) tableDiet = f
      const r = await ctx.current.showMenu?.(String(section || '').trim(), f)
      if (!r?.ok) return { ok: false, error: r?.error || 'The menu could not be shown.' }
      return {
        ok: true,
        showing: true,
        open_at: r.section,
        sections: r.sections,
        ...(f && { filtered: dietaryLabel(f) }),
        ...(section && !r.matched && { note: `There is no "${section}" section; it is open at ${r.section}.` }),
        next:
          'The menu card is on screen. Say a short line about this section; they can swipe through it or ask you to turn to another section.' +
          (f ? ' It shows only dishes that fit the filter. Dishes marked "not yet confirmed by the kitchen" must be checked with staff; never promise they are suitable.' : ''),
      }
    },

    async get_menu({ category, search, diet, avoid, clear_filter } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const f = clear_filter ? null : dietFrom({ diet, avoid })
      if (clear_filter) tableDiet = null
      const q = new URLSearchParams({ ...(category && { section: category }), ...(search && { search }) })
      for (const [k, v] of dietaryQuery(f)) q.set(k, v)
      const { status, body } = await oasys(`menu${q.size ? `?${q}` : ''}`)
      if (status !== 200) return { ok: false, error: body.error || 'Could not load the Vasamo menu.' }
      if (f) {
        tableDiet = f
        const dishes = (body.dishes || []).filter((d) => !d.sold_out)
        const names = (list) => ({ names: list.slice(0, 40).map((d) => d.name), ...(list.length > 40 && { more: list.length - 40 }) })
        const sure = dishes.filter((d) => d.confirmed)
        const unsure = dishes.filter((d) => !d.confirmed)
        const allergy = f.avoid.some((a) => ALLERGY_AVOIDS.has(a))
        const signed = body.dietary?.signed_off
        return {
          ok: true,
          filter: dietaryLabel(f),
          ...(sure.some((d) => d.fit === 'yes') && { suitable: names(sure.filter((d) => d.fit === 'yes')) }),
          ...(sure.some((d) => d.fit === 'with-changes') && { suitable_without_the_usual_sides: names(sure.filter((d) => d.fit === 'with-changes')) }),
          ...(unsure.length && { not_yet_confirmed_by_kitchen: names(unsure.map((d) => (d.fit === 'with-changes' ? { name: `${d.name} (without the usual sambar and chutneys)` } : d))) }),
          tags_signed_off: signed ? `by ${signed.by} on ${signed.on}, ${signed.dishes} dishes` : false,
          ...(!dishes.length && { note: 'Nothing on the menu fits that right now.' }),
          next: [
            'Suggest a few fitting dishes; do not read out the whole list.',
            unsure.length &&
              'The kitchen has NOT yet confirmed the tags for the dishes under not_yet_confirmed_by_kitchen: say they should fit but the guest must check with the staff before ordering. Never promise.',
            dishes.some((d) => d.fit === 'with-changes') &&
              'Some dishes fit only without the sambar and chutneys they usually come with (those have onion and garlic): offer to ask the kitchen for that as a special request.',
            allergy &&
              'This is about an allergy: ALWAYS also tell the guest to mention the allergy to the staff, because the kitchen is shared and some ingredients (like asafoetida, which can contain wheat) are not tagged. Never call a dish safe or allergen-free.',
            (f.diet === 'jain' || f.avoid.some((a) => ['onion', 'garlic', 'onion-garlic'].includes(a))) &&
              'They can also ask for another dish without onion or garlic as a special request, but only the kitchen can say whether that works.',
          ].filter(Boolean).join(' '),
        }
      }
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

    // A round for the table's open tab: matched, checked and priced, then shown for the guest's yes.
    // Nothing is billed here: rounds pile up on the tab through the meal and are paid at close_tab.
    async place_order({ items, table, guest_name, guest_email, replace, kitchen_note } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const wanted = (Array.isArray(items) ? items : [])
        .map((i) => {
          const note = cleanNote(i?.note, NOTE_MAX)
          return {
            // dishes tapped on the menu card carry their id, so there is no guessing from the name
            ...(Number.isInteger(i?.dish_id) && i.dish_id > 0 && { dish_id: i.dish_id }),
            name: String(i?.name || '').trim(),
            quantity: Math.max(1, Math.floor(Number(i?.quantity) || 1)),
            ...(note && { note }), // a special request for the kitchen: "less oil", "no onion"
          }
        })
        .filter((i) => i.name || i.dish_id)
      if (!wanted.length) return { ok: false, error: 'What would they like to order?' }
      // a round already waiting for the guest's yes keeps its dishes: these are added to it
      // (unless the guest wants to start the round over), so browsing the menu loses nothing
      const waiting = pendingOrder && Date.now() - pendingOrder.at < 10 * 60_000 && replace !== true ? pendingOrder : null
      const kept = waiting ? waiting.items.map((i) => ({ dish_id: i.dish_id, quantity: i.quantity, ...(i.note && { note: i.note }) })) : []
      // a request for the whole round adds to one the waiting round already has
      const roundNote = joinNotes(waiting?.kitchen_note, cleanNote(kitchen_note, KITCHEN_NOTE_MAX))
      const tab = await currentTab()
      const order = {
        table_no: tab?.table_no || String(table || '').trim() || ctx.current.tableNo?.() || undefined,
        customer: tab?.customer || String(guest_name || '').trim() || personFor(ctx) || undefined,
      }
      // an address said up front is only remembered to suggest later; e-receipts are sent after the tab is paid
      const suggestedEmail = normEmail(guest_email) || waiting?.suggestedEmail || ''
      const { status, body } = await oasys('orders', {
        ...order, items: [...kept, ...wanted], ...(roundNote && { kitchen_note: roundNote }), dry_run: true,
      })
      if (status === 422) {
        // the waiting round (if any) stays as it was; only the new items had a problem
        if (waiting) {
          waiting.at = Date.now()
          ctx.current.showOrder?.({ stage: 'pending', ...waiting.card, problems: describeProblems(body.problems) })
        } else {
          pendingOrder = null
          ctx.current.showOrder?.({ stage: 'problem', problems: describeProblems(body.problems) })
        }
        return {
          ok: false,
          problems: describeProblems(body.problems),
          ...(waiting
            ? {
                still_waiting: waiting.card.lines.map((l) => `${l.quantity} x ${l.name}`),
                next: 'Nothing was added: tell the guest about the problem and ask what they want instead, then call place_order with only that item. The round waiting for a yes is unchanged.',
              }
            : {
                can_order: (body.lines || []).map((l) => `${l.quantity} x ${l.name}`),
                next: 'Tell the guest about the problems and ask what they want instead, then call place_order again with the full round.',
              }),
        }
      }
      if (status !== 200) return { ok: false, error: body.error || 'The order could not be checked.' }
      const round = (tab?.rounds?.length || 0) + 1
      const card = {
        lines: body.lines, table: order.table_no, round, tab_total: tab?.total || 0, kitchen_note: roundNote || null,
        subtotal: body.subtotal, tax: body.tax, tax_rate: body.tax_rate, service_charge: body.service_charge, total: body.total,
      }
      pendingOrder = { ...order, items: itemsOf(body.lines), kitchen_note: roundNote || null, suggestedEmail, card, at: Date.now() }
      ctx.current.showOrder?.({ stage: 'pending', ...card })
      // a dish that doesn't fit the dietary filter someone at the table asked for
      const fits = tableDiet ? await passingIds(tableDiet) : null
      const clash = fits ? [...new Set(body.lines.filter((l) => !fits.has(l.dish_id)).map((l) => l.name))] : []
      return {
        ok: true,
        round,
        ...(clash.length && {
          dietary_check: { asked_for: dietaryLabel(tableDiet), does_not_fit: clash },
        }),
        ...(kept.length && { added_to_waiting_round: true }),
        order: body.lines.map((l) => `${l.quantity} x ${l.name}${l.note ? ` (${l.note})` : ''} at ${rupees(l.unit_price)} = ${rupees(l.line_total)}`),
        ...(roundNote && { kitchen_note: roundNote }),
        this_round_total: rupees(body.total),
        ...(tab && { tab_so_far: rupees(tab.total) }),
        table: order.table_no || null,
        next:
          'Read back ONLY the items and quantities, with any special requests, e.g. "one chicken biryani with less oil and two Coca-Colas, shall I send that to the kitchen?". ' +
          'Do NOT say any price or total out loud: the amounts are on the card on screen. ' +
          'Say an amount only if the guest asks for it, and then use ONLY the figures in this result. ' +
          'Ask the guest to confirm, then call confirm_order with their answer. ' +
          'Do NOT ask how they will pay: the order goes on their tab, which stays open while they eat and is paid only when they ask to close it.' +
          (clash.length
            ? ` Earlier a guest asked for: ${dietaryLabel(tableDiet)}. ${clash.join(', ')} ${clash.length === 1 ? 'does' : 'do'} not fit that. ` +
              'Before confirming, mention it once, gently ("just to check, that one has onion, is it for you?"). If it is for someone else, carry on.'
            : ''),
      }
    },

    // The guest's yes (or no) to the round from place_order: on yes it goes on the tab and to the kitchen.
    async confirm_order({ confirm } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      if (!pendingOrder || Date.now() - pendingOrder.at > 10 * 60_000) {
        pendingOrder = null
        return { ok: false, error: 'There is no order waiting. Call place_order first.' }
      }
      const show = (o) => ctx.current.showOrder?.(o)
      if (confirm !== true) {
        pendingOrder = null
        show({ stage: 'cancelled' })
        return { ok: true, cancelled: true, next: 'Say it is cancelled. Their tab (if any) is unchanged.' }
      }
      const { suggestedEmail, at, card, ...order } = pendingOrder
      pendingOrder = null
      const tab = await currentTab()
      const { status, body } = await oasys('tab/add', { ...order, session_id: tab?.session_id, source: 'greeny' })
      if (status === 422) {
        show({ stage: 'problem', problems: describeProblems(body.problems) })
        return { ok: false, problems: describeProblems(body.problems), next: 'Stock changed. Tell the guest and offer alternatives.' }
      }
      if (status !== 201) {
        show({ stage: 'problem', problems: [body.error || 'The order could not be sent.'] })
        return { ok: false, error: body.error || 'The order could not be sent.' }
      }
      if (suggestedEmail) tabEmail = suggestedEmail
      setTab(body.tab)
      const round = body.tab.rounds.at(-1)
      show({
        stage: 'added', round: body.round_no, lines: round.items, kitchen_note: round.kitchen_note || null,
        table: body.tab.table_no, tab_total: body.tab.total, rounds: body.tab.rounds.length,
      })
      return {
        ok: true,
        sent_to_kitchen: true,
        round: body.round_no,
        tab_so_far: rupees(body.tab.total),
        next:
          'Tell the guest it has gone to the kitchen, in one short sentence. Do NOT ask about payment or receipts: the tab stays open. ' +
          'They can order more at any time (call place_order again for each new round). ' +
          'Only when they ask for the bill or to close the tab, call close_tab.',
      }
    },

    // A special request for the kitchen ("less oil", "no onion", "serve the starters first") on the
    // round still waiting for the guest's yes: for one dish (item) or, without item, the whole round.
    // It changes nothing on the bill, so nothing is re-priced; the card shows it for the guest to check.
    add_special_request({ request, item, quantity } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const waiting = pendingOrder && Date.now() - pendingOrder.at < 10 * 60_000 ? pendingOrder : null
      if (!waiting) {
        return {
          ok: false,
          error: 'There is no round waiting for the guest\'s yes, so there is nothing to add the request to.',
          next:
            'If they are about to order, pass the request with place_order (an item\'s note, or kitchen_note for the whole round). ' +
            'If the round has already gone to the kitchen, say you cannot change it from here and a waiter will pass the message on.',
        }
      }
      const max = item ? NOTE_MAX : KITCHEN_NOTE_MAX
      const said = cleanNote(request, max)
      if (!said) return { ok: false, error: 'What is the special request? For example "less oil" or "no onion".' }
      const lines = waiting.card.lines.map((l) => ({ ...l }))

      if (item) {
        const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => namesDish(item, l.name))
        if (!hits.length) {
          return {
            ok: false,
            error: `"${item}" is not in the round waiting for a yes.`,
            in_this_round: lines.map((l) => l.name),
            next: 'Ask which dish they meant, or if it is a new dish, add it with place_order and its note.',
          }
        }
        // the same dish twice ("masala dosa" and "masala dosa, no onion") or two dishes that both match: ask
        if (hits.length > 1 && new Set(hits.map(({ l }) => l.name)).size > 1) {
          return { ok: false, error: `"${item}" could be ${hits.map(({ l }) => l.name).join(' or ')}.`, next: 'Ask which one they meant.' }
        }
        // the plain line, if the dish is there with and without a request
        const { l, i } = hits.find(({ l }) => !l.note) || hits[0]
        const n = Math.floor(Number(quantity) || 0)
        const note = joinNotes(l.note, said, NOTE_MAX)
        if (n >= 1 && n < l.quantity) {
          // only some of them: "one of the two dosas without onion" splits the line
          const each = l.unit_price
          lines.splice(i, 1,
            { ...l, quantity: l.quantity - n, line_total: Math.round(each * (l.quantity - n) * 100) / 100 },
            { ...l, quantity: n, line_total: Math.round(each * n * 100) / 100, note })
        } else lines[i] = { ...l, note }
      } else {
        waiting.kitchen_note = joinNotes(waiting.kitchen_note, said)
      }

      waiting.card = { ...waiting.card, lines, kitchen_note: waiting.kitchen_note || null }
      waiting.items = itemsOf(lines)
      waiting.at = Date.now()
      ctx.current.showOrder?.({ stage: 'pending', ...waiting.card })
      return {
        ok: true,
        order: lines.map((l) => `${l.quantity} x ${l.name}${l.note ? ` (${l.note})` : ''}`),
        ...(waiting.kitchen_note && { kitchen_note: waiting.kitchen_note }),
        next:
          'Say briefly that you have noted it for the kitchen (it is on the card), then ask again whether to send the round. ' +
          'Do not promise the kitchen can always do it. When they say yes, call confirm_order.',
      }
    },

    // What is on the table's tab so far.
    async view_tab() {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const tab = await currentTab()
      if (!tab || !tab.rounds.length) return { ok: true, open: false, note: 'Nothing has been ordered on this table yet.' }
      ctx.current.showOrder?.({ stage: 'tab', ...tabCard(tab) })
      return {
        ok: true,
        open: true,
        rounds: tab.rounds.length,
        items: tab.lines.map((l) => `${l.quantity} x ${l.name}`),
        total_so_far: rupees(tab.total),
        next: 'The tab is on screen. Say briefly what they have had; say the total only if they asked for it. The tab stays open.',
      }
    },

    // Close the tab when the guest asks for the bill: show everything, ask how they pay, then bill it once.
    async close_tab({ payment_method } = {}) {
      if (!ctx.current.oasysConnected()) return OASYS_OFF
      const tab = await currentTab()
      if (!tab || !tab.rounds.length) return { ok: false, error: 'There is no open tab on this table: nothing has been ordered yet.' }
      const show = (o) => ctx.current.showOrder?.(o)
      const pay = PAYMENT_METHODS[String(payment_method || '').trim().toLowerCase()]
      if (!pay) {
        show({ stage: 'payment', ...tabCard(tab) })
        return {
          ok: false,
          closed: false,
          needs: 'payment_method',
          items: tab.lines.map((l) => `${l.quantity} x ${l.name}`),
          total: rupees(tab.total),
          next:
            'The whole tab is on screen with its total. Ask the guest how they will pay: cash, UPI or card (never assume cash; ' +
            'the card on screen has the three buttons too). Then call close_tab again with their answer as payment_method. ' +
            'If they want to order something more instead, the tab stays open: carry on with place_order.',
        }
      }
      const { status, body } = await oasys('tab/close', { session_id: tab.session_id, payment_mode: pay.mode, source: 'greeny' })
      if (status !== 201) {
        show({ stage: 'problem', problems: [body.error || 'The tab could not be closed.'] })
        return { ok: false, error: body.error || 'The tab could not be closed.' }
      }
      setTab(null)
      tableDiet = null // the next guests at this table start without a filter
      if (!body.bill) return { ok: true, closed: true, note: 'The tab had nothing on it, so nothing was billed.' }
      // a registered guest (recognised by face, else by voice) may have an address from last time
      const guest = ctx.current.onCamera() || ctx.current.speaker() || ''
      const suggestedEmail = tabEmail
      tabEmail = ''
      const knownEmail = suggestedEmail || !guest ? '' : await savedEmail(guest)
      lastOrder = { bill_no: body.bill.bill_no, total: body.bill.total, table: body.bill.table_no, at: Date.now(), guest, email: suggestedEmail || knownEmail }
      pendingReceipt = null
      show({ stage: 'placed', ...lastOrder })
      return {
        ok: true,
        paid: true,
        payment: pay.label,
        bill_no: body.bill.bill_no,
        total: rupees(body.bill.total),
        next:
          'Thank the guest: the tab is closed and paid. Give the bill number, but do not say the total unless they ask. ' +
          'Then ask whether they would like a paper receipt, an e-receipt by email, both, or neither ' +
          '(the card on screen also has a print button and a box to type the email). ' +
          'Wait for their answer. Call print_receipt (guest_asked true) ONLY if they say yes to a paper receipt; never print on your own. For an e-receipt: ' +
          (suggestedEmail ? `They mentioned ${suggestedEmail} earlier: if they want it, call set_receipt_email with it so they can confirm it. ` : '') +
          (knownEmail
            ? `${guest} had the e-receipt sent to ${knownEmail} last time. If they want an e-receipt, ask whether to send it to that same address or to a new one, ` +
              'then call set_receipt_email with the address they choose. '
            : '') +
          'If yes, call set_receipt_email with the address. Never send anything until they have confirmed the address. ' +
          'Once the receipts are settled (or they want none), call rate_meal without a rating to show the rating card.',
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
      return { ok: true, sent: true, to: body.to, bill_no, next: 'Say it is sent, then call rate_meal without a rating to ask how the meal was.' }
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
