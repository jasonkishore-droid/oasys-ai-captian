import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './icons.jsx'

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

// the room an order card takes on the left (matches .studio-order in studio.css), on wide screens
const orderRoom = (on) => {
  const W = window.innerWidth
  if (!on || W <= 720) return 0
  const gap = Math.max(16, W * 0.03)
  return Math.min(400, W * 0.42) + gap * 2
}

// The dock under the cards: the order strip (only when ordering is on) and the menu bar.
// Its height never changes while the menu is open, so the cards never jump.
const BAR_HEIGHT = 54
const STRIP_HEIGHT = 58
const TALK_HEIGHT = 44 // the "Talk to Greeny" button under the bar

// The card's size on screen. Text inside is sized from the card's width, so it all scales together.
const MAX_CARD_WIDTH = 270
function cardSize(withOrder, ordering, talk) {
  const width = window.innerWidth - orderRoom(withOrder)
  const dock = BAR_HEIGHT + (ordering ? STRIP_HEIGHT + 10 : 0) + (talk ? TALK_HEIGHT + 10 : 0)
  const w = Math.max(190, Math.min(MAX_CARD_WIDTH, width * (withOrder ? 0.42 : 0.55)))
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
  const reviewed = useRef(false) // the tray is the round on the order card, waiting for Confirm
  const ordering = !!onOrder
  const talk = !!onTalk
  const [size, setSize] = useState(() => cardSize(withOrder, ordering, talk))
  const [leaving, setLeaving] = useState(false)
  const dragState = useRef(null)
  const moved = useRef(false)

  // the round the tray became was confirmed: start a fresh tray. Cancelled: keep it to change.
  useEffect(() => {
    if (!reviewed.current) return
    if (orderStage === 'added') {
      reviewed.current = false
      setTray([])
      setTrayMsg('')
    } else if (orderStage === 'cancelled' || orderStage === 'problem') {
      reviewed.current = false
    }
  }, [orderStage])

  const pick = (dish, by) => {
    if (dish.soldOut) return
    setTrayMsg('')
    setTray((t) => changeTray(t, dish, by))
  }

  const review = async () => {
    if (!tray.length || sending) return
    setSending(true)
    setTrayMsg('')
    try {
      const r = await onOrder(tray.map((t) => ({ dish_id: t.id, name: t.name, quantity: t.quantity })))
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

  const close = useCallback(() => {
    setLeaving(true)
    setTimeout(onClose, 260)
  }, [onClose])

  useEffect(() => setSize(cardSize(withOrder, ordering, talk)), [withOrder, ordering, talk])
  useEffect(() => {
    const onResize = () => setSize(cardSize(withOrder, ordering, talk))
    const onKey = (e) => {
      if (e.key === 'ArrowRight') turn(1)
      if (e.key === 'ArrowLeft') turn(-1)
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [turn, close, withOrder, ordering])

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

  const onCardClick = (i) => {
    if (moved.current || i === active) return
    turnTo(i)
  }

  const current = sections[active]
  if (!current) return null

  return (
    <div
      className={`menu-carousel${leaving ? ' leaving' : ''}${withOrder ? ' with-order' : ''}`}
      style={{ '--order-room': `${orderRoom(withOrder)}px` }}
      role="dialog"
      aria-label="Menu card"
    >
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
            return (
              <article
                key={sec.title}
                className={`mc-card${isActive ? ' active' : ''}`}
                style={{
                  transform: `rotateY(${i * STEP}deg) translateZ(${radius}px)`,
                  filter: `brightness(${Math.max(0.42, 1 - distance * 0.2)})`,
                }}
                onClick={() => onCardClick(i)}
                aria-hidden={!isActive}
              >
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
                              onClick={(e) => {
                                e.stopPropagation()
                                if (!moved.current) pick(d, 1)
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
              </article>
            )
          })}
        </div>
      </div>
      <div className="mc-floor" aria-hidden="true" />
      <div className="mc-dock">
        {ordering && (
          <section className={`mc-strip${tray.length ? '' : ' empty'}`} aria-label="Your order">
            {tray.length === 0 ? (
              <p className="mc-strip-empty">Tap a dish to add it to your order</p>
            ) : (
              <>
                <ul className="mc-strip-items">
                  {tray.map((t) => (
                    <li key={t.id}>
                      <span className="mc-strip-name" title={t.name}>
                        {t.name}
                      </span>
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
                  <button type="button" className="mc-strip-clear" onClick={() => (setTray([]), setTrayMsg(''))} disabled={sending} aria-label="Clear your order">
                    Clear
                  </button>
                  <button type="button" className="mc-strip-go" onClick={review} disabled={sending}>
                    {sending ? 'Checking…' : 'Review order'}
                  </button>
                </div>
              </>
            )}
            {trayMsg && (
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
