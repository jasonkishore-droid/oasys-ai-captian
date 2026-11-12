import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './icons.jsx'
import BookModel from './book/BookModel.jsx'
import { menuContent } from './book/content.js'

// The menu can be read two ways: the carousel of cards, or a 3D book with pages that turn.
// The guest's choice is remembered in this browser.
const VIEW_KEY = 'greeny.menuView'
const savedView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'book' ? 'book' : 'cards'
  } catch {
    return 'cards'
  }
}
// If the book cannot be drawn (no WebGL on this device), quietly go back to the cards.
class BookBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    console.warn('[menu] the 3D book could not be shown:', error)
    this.props.onFail?.()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

// The menu card, as a 3D carousel (from the Menu Card project, ../Menue Card/src/Carousel.jsx).
// Each menu section is a paper card standing on a ring; turning the ring brings the next section
// forward. The dishes and prices come live from the inventory (/api/oasys/menu), so they always
// match what can be ordered; sold-out dishes are struck through.
//
// `section` (a name, or null) turns the ring to that section, e.g. when Greeny is asked for desserts.

// the section notes printed on the Menu Card
const NOTES = {
  'Breakfast & Tiffin': 'Served with sambar and two chutneys',
  'Dosa Varieties': 'Crisp from the tawa, served with sambar and chutneys',
  'Chicken Starters': 'Chettinad kitchen and tandoor',
  'From the Sea': 'Fresh catch, subject to availability',
  'Biryani & Rice': 'Biryani is made with seeraga samba rice',
  Meals: 'Lunch only, 12 noon to 3.30 pm',
}
const DIET = { veg: 'v', nonveg: 'n', egg: 'e' }
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// the live menu, grouped into sections in menu order
export async function loadMenuSections() {
  const r = await fetch('/api/oasys/menu')
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The menu could not be loaded')
  const { dishes = [] } = await r.json()
  const by = new Map()
  for (const d of dishes) {
    if (!by.has(d.section)) by.set(d.section, { title: d.section, note: NOTES[d.section] || '', items: [] })
    by.get(d.section).items.push({ id: d.id, name: d.name, price: d.price, type: DIET[d.diet] || 'v', desc: d.description, soldOut: d.sold_out })
  }
  return [...by.values()]
}

// the section whose name best matches what was asked for ("desserts", "dosa", "starters")
export function findSection(sections, wanted) {
  const w = norm(wanted).replace(/s\b/g, '')
  if (!w) return -1
  const words = w.split(' ')
  let best = -1
  let score = 0
  sections.forEach((s, i) => {
    const t = norm(s.title).replace(/s\b/g, '')
    const sc = t === w ? 100 : t.includes(w) ? 50 : words.filter((x) => x.length > 2 && t.includes(x)).length * 10
    if (sc > score) (score = sc), (best = i)
  })
  return best
}

// The guest's picks while ordering by hand: [{ id, name, price, quantity }], in the order they were tapped.
export const MAX_PER_DISH = 50 // the most the order API takes of one dish
export function changeTray(tray, dish, by) {
  const at = tray.findIndex((t) => t.id === dish.id)
  if (at < 0) return by > 0 ? [...tray, { id: dish.id, name: dish.name, price: dish.price, quantity: Math.min(MAX_PER_DISH, by) }] : tray
  const quantity = Math.min(MAX_PER_DISH, tray[at].quantity + by)
  return quantity > 0 ? tray.map((t, i) => (i === at ? { ...t, quantity } : t)) : tray.filter((_, i) => i !== at)
}
// a dish's special request for the kitchen ("less oil"), or '' to remove it
export function noteTray(tray, id, note) {
  const clean = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
  return tray.map((t) => (t.id === id ? { ...t, note: clean || undefined } : t))
}
export const NOTE_MAX = 100 // what the order API takes for one dish's request
export const KITCHEN_NOTE_MAX = 200 // and for the whole round's
// the quick choices in the request editor; anything else can be typed
const DISH_REQUESTS = ['Less oil', 'Less spicy', 'Extra spicy', 'No onion', 'No garlic', 'Jain']
const ROUND_REQUESTS = ['Serve together', 'Starters first', 'Make everything mild']

// The special-request editor above the order strip: quick choices plus a text box.
// `target` is a tray item, or null for the whole round.
function RequestEditor({ target, value, onSave, onCancel }) {
  const max = target ? NOTE_MAX : KITCHEN_NOTE_MAX
  const [text, setText] = useState(value || '')
  const inputRef = useRef(null)
  useEffect(() => inputRef.current?.focus(), [])
  const parts = text.split(/\s*[;,]\s*/).filter(Boolean)
  const has = (q) => parts.some((p) => p.toLowerCase() === q.toLowerCase())
  const toggle = (q) =>
    setText((has(q) ? parts.filter((p) => p.toLowerCase() !== q.toLowerCase()) : [...parts, q]).join(', ').slice(0, max))
  const save = () => onSave(text)
  return (
    <div
      className="mc-request"
      role="dialog"
      aria-label={target ? `Special request for ${target.name}` : 'Note for the kitchen'}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <strong>{target ? `Request for ${target.name}` : 'Note for the kitchen'}</strong>
      <div className="mc-request-quick">
        {(target ? DISH_REQUESTS : ROUND_REQUESTS).map((q) => (
          <button key={q} type="button" className={has(q) ? 'on' : ''} aria-pressed={has(q)} onClick={() => toggle(q)}>
            {q}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => (e.preventDefault(), save())}>
        <input
          ref={inputRef}
          value={text}
          maxLength={max}
          onChange={(e) => setText(e.target.value)}
          placeholder={target ? 'Or type it, e.g. less salt' : 'Or type it, e.g. bring the rice later'}
          aria-label="Special request"
        />
        <button type="submit" className="mc-request-done">Done</button>
        {value && (
          <button type="button" onClick={() => onSave('')}>
            Remove
          </button>
        )}
        <button type="button" className="mc-request-cancel" onClick={onCancel} aria-label="Cancel">
          ✕
        </button>
      </form>
    </div>
  )
}

export function trayTotals(tray) {
  return {
    count: tray.reduce((n, t) => n + t.quantity, 0),
    total: tray.reduce((n, t) => n + t.quantity * Number(t.price || 0), 0),
  }
}
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function Flourish() {
  return (
    <svg className="mc-flourish" viewBox="0 0 200 14" aria-hidden="true">
      <path d="M2 7 H78 M122 7 H198" stroke="currentColor" strokeWidth="0.8" />
      <path d="M100 1 L106 7 L100 13 L94 7 Z" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="100" cy="7" r="1.6" fill="currentColor" />
      <circle cx="84" cy="7" r="1.4" fill="currentColor" />
      <circle cx="116" cy="7" r="1.4" fill="currentColor" />
    </svg>
  )
}

function Mark({ type }) {
  const label = type === 'v' ? 'Vegetarian' : type === 'e' ? 'Contains egg' : 'Non-vegetarian'
  return <span className={`mc-mark mc-mark-${type}`} role="img" aria-label={label} title={label} />
}

// On wide screens the guest's order is a square panel on the left of the window (on phones it
// stays a strip under the cards). An order card, when one is open, takes that same place.
const WIDE = 720
const sidePanel = (ordering) => ordering && window.innerWidth > WIDE
const panelGap = () => Math.round(Math.max(16, window.innerWidth * 0.03))
const panelWidth = () => Math.round(Math.min(320, Math.max(260, window.innerWidth * 0.26)))

// the room on the left: an order card (matches .studio-order in studio.css), or else the order panel
const orderRoom = (withOrder, ordering = false) => {
  const W = window.innerWidth
  if (W <= WIDE) return 0
  if (withOrder) return Math.min(400, W * 0.42) + panelGap() * 2
  if (sidePanel(ordering)) return panelWidth() + panelGap() * 2
  return 0
}

// The dock under the cards: the order strip (only when ordering is on) and the menu bar.
// Its height never changes while the menu is open, so the cards never jump.
const BAR_HEIGHT = 54
const STRIP_HEIGHT = 58
const TALK_HEIGHT = 44 // the "Talk to Greeny" button under the bar

// The card's size on screen. Text inside is sized from the card's width, so it all scales together.
const MAX_CARD_WIDTH = 270
// the big card: as tall as the screen allows, the same shape as the ring's cards
// (`room`: the space the order panel takes on the left, which the big card keeps clear of)
function zoomSize(size, room = 0) {
  const ratio = size.w / size.h
  let h = Math.max(300, window.innerHeight - 48)
  let w = h * ratio
  const maxW = Math.min(760, window.innerWidth - room - 32)
  if (w > maxW) {
    w = maxW
    h = w / ratio
  }
  return { width: Math.round(w), height: Math.round(h) }
}

// the 3D book's height: everything above the menu bar
function bookHeight(ordering, talk) {
  const strip = ordering && !sidePanel(ordering)
  const dock = BAR_HEIGHT + (strip ? STRIP_HEIGHT + 10 : 0) + (talk ? TALK_HEIGHT + 10 : 0)
  return Math.round(Math.max(300, window.innerHeight - dock - 70))
}

function cardSize(withOrder, ordering, talk) {
  const width = window.innerWidth - orderRoom(withOrder, ordering)
  // the order strip sits under the cards only on narrow screens; wide ones have the side panel
  const strip = ordering && !sidePanel(ordering)
  const dock = BAR_HEIGHT + (strip ? STRIP_HEIGHT + 10 : 0) + (talk ? TALK_HEIGHT + 10 : 0)
  const w = Math.max(190, Math.min(MAX_CARD_WIDTH, width * (withOrder || sidePanel(ordering) ? 0.42 : 0.55)))
  const h = Math.max(250, Math.min(w * 1.45, window.innerHeight - 150 - dock))
  return { w: Math.round(w), h: Math.round(h) }
}

// `onOrder(items)` (when ordering is on) lets the guest order by hand: tapping a dish puts it in the
// order strip, and "Review order" sends it through the same check-and-confirm as a spoken order.
// `orderStage` is the order card's stage, so the strip empties once the round has gone to the kitchen.
// `onTalk` (when the voice chat is off) puts a "Talk to Greeny" button under the menu bar.
export default function MenuCarousel({ sections, section: ask, withOrder = false, onClose, onOrder, orderStage, onTalk }) {
  // `ask` is { name, at }: a new `at` turns the ring again even to the same section
  const section = ask?.name ?? null
  const COUNT = Math.max(1, sections.length)
  const STEP = 360 / COUNT // degrees between neighbouring cards
  // `pos` counts cards turned and is never wrapped, so the ring always takes the short way round
  const [pos, setPos] = useState(() => Math.max(0, findSection(sections, section)))
  const [drag, setDrag] = useState(0) // fraction of a card, while dragging
  const [dragging, setDragging] = useState(false)
  const [tray, setTray] = useState([])
  const [sending, setSending] = useState(false)
  const [trayMsg, setTrayMsg] = useState('')
  const [roundNote, setRoundNote] = useState('') // a special request for the whole round
  const [noteFor, setNoteFor] = useState(null) // the request editor: a dish id, 'round', or closed
  const reviewed = useRef(false) // the tray is the round on the order card, waiting for Confirm
  const ordering = !!onOrder
  const talk = !!onTalk
  const [size, setSize] = useState(() => cardSize(withOrder, ordering, talk))
  const [leaving, setLeaving] = useState(false)
  const dragState = useRef(null)
  const moved = useRef(false)
  // a double-click / double-tap on a card opens it large in the middle (index), or null
  const [zoom, setZoom] = useState(null)
  // 'cards' (the carousel) or 'book' (the 3D book)
  const [view, setViewState] = useState(savedView)
  const setView = (v) => {
    setViewState(v)
    setZoom(null)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {}
  }
  const book = useMemo(() => menuContent(sections), [sections])
  const [bookAt, setBookAt] = useState(null) // { page, at }: turn the book to a section
  const [restaurant, setRestaurant] = useState('')
  const lastTap = useRef({ i: -1, t: 0 })

  // the round the tray became was confirmed: start a fresh tray. Cancelled: keep it to change.
  useEffect(() => {
    if (!reviewed.current) return
    if (orderStage === 'added') {
      reviewed.current = false
      setTray([])
      setTrayMsg('')
      setRoundNote('')
      setNoteFor(null)
    } else if (orderStage === 'cancelled' || orderStage === 'problem') {
      reviewed.current = false
    }
  }, [orderStage])

  const pick = (dish, by) => {
    if (dish.soldOut) return
    setTrayMsg('')
    setTray((t) => changeTray(t, dish, by))
  }

  // Dragging a dish onto "Your order" adds it, like a tap. A drag starts once the pointer moves
  // sideways (up and down still scrolls the list); a small chip follows it, and the order lights up.
  const stripRef = useRef(null)
  const [dragDish, setDragDish] = useState(null) // { dish, x, y, over }
  const [dropped, setDropped] = useState(0) // bumps to flash the order when a dish lands
  const skipClick = useRef(false) // the click that ends a drag must not add the dish again
  const overOrder = (x, y) => {
    const r = stripRef.current?.getBoundingClientRect()
    return !!r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  const startDishDrag = (e, dish) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.stopPropagation() // not a swipe of the ring
    const x0 = e.clientX
    const y0 = e.clientY
    let dragging = false
    const move = (ev) => {
      const dx = ev.clientX - x0
      const dy = ev.clientY - y0
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return
        if (Math.abs(dx) < Math.abs(dy)) return end() // scrolling the list, not a drag
        dragging = true
        skipClick.current = true
      }
      ev.preventDefault()
      setDragDish({ dish, x: ev.clientX, y: ev.clientY, over: overOrder(ev.clientX, ev.clientY) })
    }
    const up = (ev) => {
      if (dragging && overOrder(ev.clientX, ev.clientY)) {
        pick(dish, 1)
        setDropped((n) => n + 1)
      }
      end()
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', end)
      setDragDish(null)
      if (dragging) setTimeout(() => (skipClick.current = false), 0)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', end)
  }

  const review = async () => {
    if (!tray.length || sending) return
    setSending(true)
    setTrayMsg('')
    setNoteFor(null)
    try {
      const r = await onOrder(
        tray.map((t) => ({ dish_id: t.id, name: t.name, quantity: t.quantity, ...(t.note && { note: t.note }) })),
        roundNote
      )
      if (r?.ok) reviewed.current = true
      else if (r?.error) setTrayMsg(r.error)
      else if (r?.problems?.length) setTrayMsg(r.problems.join(' '))
    } catch (e) {
      setTrayMsg(e.message || 'The order could not be checked.')
    } finally {
      setSending(false)
    }
  }

  const active = ((pos % COUNT) + COUNT) % COUNT
  const radius = Math.round(size.w / 2 / Math.tan(Math.PI / COUNT)) + 34
  const turn = useCallback((by) => setPos((p) => p + by), [])
  // the short way round from the front card to card i
  const turnTo = useCallback((i) => {
    setPos((p) => {
      const a = ((p % COUNT) + COUNT) % COUNT
      return p + (((i - a + COUNT + COUNT / 2) % COUNT) - COUNT / 2)
    })
  }, [COUNT])

  // asked for a section by voice: turn to it
  useEffect(() => {
    const i = findSection(sections, section)
    if (i >= 0) turnTo(i)
  }, [ask, sections, turnTo]) // eslint-disable-line react-hooks/exhaustive-deps

  // the section in front (turned to by voice or the ‹ › buttons) opens the book at its page;
  // switching to the book starts at its cover
  const bookStart = useRef(true)
  useEffect(() => {
    if (view !== 'book') {
      bookStart.current = true
      return
    }
    if (bookStart.current) {
      bookStart.current = false
      return
    }
    const page = book.pageOf[sections[active]?.title]
    if (page) setBookAt({ page, at: Date.now() })
  }, [active, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // the restaurant's name for the book's cover (from the till, when ordering is connected)
  useEffect(() => {
    if (view !== 'book' || restaurant) return
    let live = true
    fetch('/api/oasys/ping')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && b?.restaurant && setRestaurant(b.restaurant))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [view, restaurant])

  const close = useCallback(() => {
    setLeaving(true)
    setTimeout(onClose, 260)
  }, [onClose])

  useEffect(() => setSize(cardSize(withOrder, ordering, talk)), [withOrder, ordering, talk])
  useEffect(() => {
    const onResize = () => setSize(cardSize(withOrder, ordering, talk))
    const onKey = (e) => {
      // in the book, the arrow keys turn its pages (BookScene listens for them)
      if (view === 'book' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return
      if (e.key === 'ArrowRight') turn(1)
      if (e.key === 'ArrowLeft') turn(-1)
      // the big card follows the ring; Escape closes it before the menu
      if (zoom !== null && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) setZoom((z) => (z + (e.key === 'ArrowRight' ? 1 : -1) + COUNT) % COUNT)
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (zoom !== null) setZoom(null)
        else close()
      }
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [turn, close, withOrder, ordering, zoom, COUNT, view])

  // dragging: listeners on the window (not pointer capture) so taps on cards still reach them
  const onPointerDown = (e) => {
    if (e.button !== 0) return
    dragState.current = { x: e.clientX, offset: 0 }
    moved.current = false
    const onMove = (ev) => {
      const dx = ev.clientX - dragState.current.x
      if (Math.abs(dx) > 6) {
        moved.current = true
        setDragging(true)
      }
      dragState.current.offset = -dx / (size.w * 0.95)
      if (moved.current) setDrag(dragState.current.offset)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (moved.current) setPos((p) => p + Math.round(dragState.current.offset))
      setDrag(0)
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // one tap on a side card turns to it; a second tap on the same card soon after opens it large.
  // (Taps on dishes do not reach here: they add the dish, so a double tap on a dish still adds two.)
  const onCardClick = (i) => {
    if (moved.current) return
    const now = performance.now()
    if (lastTap.current.i === i && now - lastTap.current.t < 400) {
      lastTap.current = { i: -1, t: 0 }
      turnTo(i)
      setZoom(i)
      return
    }
    lastTap.current = { i, t: now }
    if (i !== active) turnTo(i)
  }

  // a card's page: title, then its dishes (tappable to order on the front card and the big card)
  const cardInner = (sec, i, isActive) => (
    <div className="mc-inner">
      <header className="mc-head">
        <p className="mc-count">
          {i + 1} / {COUNT}
        </p>
        <h2>{sec.title}</h2>
        <Flourish />
        {sec.note && <p className="mc-note">{sec.note}</p>}
      </header>
      <ul className="mc-list" tabIndex={isActive ? 0 : -1}>
        {sec.items.map((d) => {
          const inTray = tray.find((t) => t.id === d.id)?.quantity || 0
          const row = (
            <>
              <div className="mc-row">
                <Mark type={d.type} />
                <span className="mc-name">{d.name}</span>
                {inTray > 0 && <span className="mc-qty">{inTray}</span>}
                <span className="mc-leader" aria-hidden="true" />
                <span className="mc-price">
                  {d.soldOut ? (
                    'Sold out'
                  ) : (
                    <>
                      <span className="mc-rupee">₹</span>
                      {Number(d.price).toLocaleString('en-IN')}
                    </>
                  )}
                </span>
              </div>
              {d.desc && <p className="mc-desc">{d.desc}</p>}
            </>
          )
          const canPick = onOrder && isActive && !d.soldOut
          return (
            <li key={d.id} className={`${d.soldOut ? 'sold-out' : ''}${inTray ? ' picked' : ''}`}>
              {canPick ? (
                <button
                  type="button"
                  className="mc-pick"
                  onPointerDown={(e) => startDishDrag(e, d)}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!moved.current && !skipClick.current) pick(d, 1)
                  }}
                  aria-label={`Add ${d.name}, ${money(d.price)}${inTray ? `, ${inTray} in your order` : ''}`}
                >
                  {row}
                </button>
              ) : (
                row
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )

  const current = sections[active]
  if (!current) return null

  return (
    <div
      className={`menu-carousel${leaving ? ' leaving' : ''}${withOrder ? ' with-order' : ''}${sidePanel(ordering) ? ' with-panel' : ''}`}
      style={{
        '--order-room': `${orderRoom(withOrder, ordering)}px`,
        '--panel-w': `${panelWidth()}px`,
        '--panel-gap': `${panelGap()}px`,
      }}
      role="dialog"
      aria-label="Menu card"
    >
      {view === 'book' ? (
        <div className="mc-book" style={{ height: bookHeight(ordering, talk) }}>
          <BookBoundary onFail={() => setView('cards')}>
            <BookModel
              height="100%"
              transparent
              title={restaurant || 'Our Menu'}
              subtitle="South Indian Kitchen"
              currency="₹"
              content={book.content}
              pages={book.pages}
              openAt={bookAt}
              labelColor={document.documentElement.dataset.theme === 'dark' ? '#d9c9a8' : '#5a4a3e'}
            />
          </BookBoundary>
        </div>
      ) : (
        <>
        <div
          className={`mc-stage${dragging ? ' dragging' : ''}`}
          style={{ height: size.h + 40 }}
          onPointerDown={onPointerDown}
          role="group"
          aria-roledescription="carousel"
          aria-label="Menu sections"
        >
          <div
            className="mc-ring"
            style={{ width: size.w, height: size.h, transform: `translateZ(${-radius}px) rotateY(${-(pos + drag) * STEP}deg)` }}
          >
            {sections.map((sec, i) => {
              const isActive = i === active
              const raw = Math.abs(i - (pos + drag)) % COUNT
              const distance = Math.min(raw, COUNT - raw)
              // only three cards show: the front one and one each side; the rest fade out behind them
              const opacity = distance <= 1 ? 1 : Math.max(0, 1 - (distance - 1) * 2)
              return (
                <article
                  key={sec.title}
                  className={`mc-card${isActive ? ' active' : ''}`}
                  style={{
                    transform: `rotateY(${i * STEP}deg) translateZ(${radius}px)`,
                    filter: `brightness(${Math.max(0.42, 1 - distance * 0.2)})`,
                    opacity,
                    pointerEvents: opacity === 0 ? 'none' : undefined,
                  }}
                  onClick={() => onCardClick(i)}
                  aria-hidden={!isActive}
                >
                  {cardInner(sec, i, isActive)}
                </article>
              )
            })}
          </div>
        </div>
        {dragDish && (
          <div className={`mc-drag-ghost${dragDish.over ? ' over' : ''}`} style={{ left: dragDish.x, top: dragDish.y }} aria-hidden="true">
            {dragDish.over ? '+ ' : ''}
            {dragDish.dish.name}
          </div>
        )}
        {zoom !== null && sections[zoom] && (
          <div className="mc-zoom" onClick={(e) => e.target === e.currentTarget && setZoom(null)}>
            <article
              className="mc-card mc-card-zoom active"
              style={zoomSize(size, !withOrder && sidePanel(ordering) ? orderRoom(false, ordering) : 0)}
              role="dialog"
              aria-label={`${sections[zoom].title}, enlarged`}
              onDoubleClick={(e) => !e.target.closest('.mc-pick') && setZoom(null)}
            >
              {cardInner(sections[zoom], zoom, true)}
              <button type="button" className="mc-zoom-close" onClick={() => setZoom(null)} aria-label="Close the enlarged card" autoFocus>
                ✕
              </button>
            </article>
          </div>
        )}
        <div className="mc-floor" aria-hidden="true" />
        </>
      )}
      <div className="mc-dock">
        {ordering && (
          <section
            ref={stripRef}
            className={`mc-strip${tray.length ? '' : ' empty'}${zoom !== null ? ' above-zoom' : ''}${dragDish ? ' drop-target' : ''}${dragDish?.over ? ' drop-over' : ''}`}
            aria-label="Your order"
          >
            {/* a short glow each time a dish is dropped in */}
            {dropped > 0 && <span key={dropped} className="mc-drop-flash" aria-hidden="true" />}
            {/* the heading shows only in the side panel */}
            <strong className="mc-strip-title">Your order</strong>
            {tray.length === 0 ? (
              <p className="mc-strip-empty">Tap a dish to add it to your order</p>
            ) : (
              <>
                {/* a note for the kitchen about the whole round: a square box, first in the order */}
                <div className="mc-strip-note">
                  <button
                    type="button"
                    className={`mc-strip-name${roundNote ? ' noted' : ''}`}
                    title={roundNote ? `Kitchen note: ${roundNote}` : 'Add a note for the kitchen about the whole order'}
                    aria-label={roundNote ? `Kitchen note: ${roundNote}. Change it` : 'Add a note for the kitchen'}
                    onClick={() => setNoteFor((n) => (n === 'round' ? null : 'round'))}
                    disabled={sending}
                  >
                    <span>{roundNote ? 'Kitchen note' : '+ Kitchen note'}</span>
                    {roundNote && <small>{roundNote}</small>}
                  </button>
                </div>
                <ul
                  className="mc-strip-items"
                  // in the strip (a row), a mouse wheel scrolls it sideways; the side panel scrolls as usual
                  onWheel={(e) => {
                    const el = e.currentTarget
                    if (el.scrollHeight <= el.clientHeight && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY
                  }}
                >
                  {tray.map((t) => (
                    <li key={t.id}>
                      {/* tap the name to add a special request for the kitchen */}
                      <button
                        type="button"
                        className={`mc-strip-name${t.note ? ' noted' : ''}`}
                        title={t.note ? `${t.name}: ${t.note}` : `${t.name}: add a special request`}
                        aria-label={t.note ? `${t.name}, request: ${t.note}. Change the request` : `Add a special request for ${t.name}`}
                        onClick={() => setNoteFor((n) => (n === t.id ? null : t.id))}
                        disabled={sending}
                      >
                        <span>{t.name}</span>
                        <small>{t.note || '+ request'}</small>
                      </button>
                      <span className="mc-stepper">
                        <button type="button" onClick={() => pick(t, -1)} aria-label={`One less ${t.name}`}>
                          −
                        </button>
                        <span aria-live="polite">{t.quantity}</span>
                        <button type="button" onClick={() => pick(t, 1)} disabled={t.quantity >= MAX_PER_DISH} aria-label={`One more ${t.name}`}>
                          +
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mc-strip-actions">
                  <span className="mc-strip-sum">
                    <strong>{money(trayTotals(tray).total)}</strong>
                    <small>
                      {trayTotals(tray).count} {trayTotals(tray).count === 1 ? 'item' : 'items'}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="mc-strip-clear"
                    onClick={() => (setTray([]), setTrayMsg(''), setRoundNote(''), setNoteFor(null))}
                    disabled={sending}
                    aria-label="Clear your order"
                  >
                    Clear
                  </button>
                  <button type="button" className="mc-strip-go" onClick={review} disabled={sending}>
                    {sending ? 'Checking…' : 'Review order'}
                  </button>
                </div>
              </>
            )}
            {noteFor !== null && (noteFor === 'round' || tray.some((t) => t.id === noteFor)) && (
              <RequestEditor
                key={noteFor}
                target={noteFor === 'round' ? null : tray.find((t) => t.id === noteFor)}
                value={noteFor === 'round' ? roundNote : tray.find((t) => t.id === noteFor)?.note}
                onSave={(text) => {
                  if (noteFor === 'round') setRoundNote(String(text).replace(/\s+/g, ' ').trim().slice(0, KITCHEN_NOTE_MAX))
                  else setTray((tr) => noteTray(tr, noteFor, text))
                  setNoteFor(null)
                }}
                onCancel={() => setNoteFor(null)}
              />
            )}
            {trayMsg && noteFor === null && (
              <p className="mc-strip-msg" role="alert">
                {trayMsg}
              </p>
            )}
          </section>
        )}
        <nav className="mc-controls" aria-label="Menu navigation">
          <div className="mc-turn">
            <button type="button" className="mc-arrow" onClick={() => turn(-1)} aria-label="Previous section">
              ‹
            </button>
            <span className="mc-label" aria-live="polite">
              {current.title}
              <span className="mc-label-count">{current.items.length} dishes</span>
            </span>
            <button type="button" className="mc-arrow" onClick={() => turn(1)} aria-label="Next section">
              ›
            </button>
          </div>
          <span className="mc-divider" aria-hidden="true" />
          <button
            type="button"
            className="mc-pill mc-view"
            onClick={() => setView(view === 'book' ? 'cards' : 'book')}
            aria-pressed={view === 'book'}
            title={view === 'book' ? 'Show the menu as cards' : 'Show the menu as a book'}
          >
            {view === 'book' ? 'Cards' : 'Book'}
          </button>
          <button type="button" className="mc-pill" onClick={close}>
            Close
          </button>
        </nav>
        {onTalk && (
          <button type="button" className="mc-pill mc-talk" onClick={onTalk}>
            <Icon name="mic" size={17} />
            <span>Talk to Greeny</span>
          </button>
        )}
      </div>
    </div>
  )
}
