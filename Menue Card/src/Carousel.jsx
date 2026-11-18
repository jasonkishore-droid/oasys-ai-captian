import { useCallback, useEffect, useRef, useState } from 'react';
import { MENU } from './menu.js';
import { Flourish, Mark, sectionPage } from './Book.jsx';

const COUNT = MENU.length;
const STEP = 360 / COUNT; // degrees between neighbouring cards

function cardSize() {
  const w = Math.max(220, Math.min(330, window.innerWidth * 0.7));
  const h = Math.max(300, Math.min(w * 1.5, window.innerHeight - 250));
  return { w: Math.round(w), h: Math.round(h) };
}

/* Each menu section is a card standing on a ring. The ring is pushed back by
   its own radius so the front card sits at the screen plane, and turning the
   ring brings the next section forward. */
export default function Carousel({ onOpenInBook }) {
  // `pos` counts cards turned and is never wrapped, so the ring always takes
  // the short way round instead of spinning back through every card.
  const [pos, setPos] = useState(0);
  const [drag, setDrag] = useState(0); // fraction of a card, while dragging
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState(cardSize);
  const dragState = useRef(null);
  const moved = useRef(false);

  const active = ((pos % COUNT) + COUNT) % COUNT;
  const radius = Math.round(size.w / 2 / Math.tan(Math.PI / COUNT)) + 34;

  const turn = useCallback((by) => setPos((p) => p + by), []);

  useEffect(() => {
    const onResize = () => setSize(cardSize());
    const onKey = (e) => {
      if (e.key === 'ArrowRight') turn(1);
      if (e.key === 'ArrowLeft') turn(-1);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [turn]);

  // Dragging: listeners go on the window (not pointer capture) so that clicks
  // on cards and their buttons still reach them.
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    dragState.current = { x: e.clientX, offset: 0 };
    moved.current = false;

    const onMove = (ev) => {
      const dx = ev.clientX - dragState.current.x;
      if (Math.abs(dx) > 6) {
        moved.current = true;
        setDragging(true);
      }
      dragState.current.offset = -dx / (size.w * 0.95);
      if (moved.current) setDrag(dragState.current.offset);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved.current) setPos((p) => p + Math.round(dragState.current.offset));
      setDrag(0);
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onCardClick = (i) => {
    if (moved.current || i === active) return;
    // Shortest signed distance round the ring from the active card to card i.
    const delta = ((i - active + COUNT + COUNT / 2) % COUNT) - COUNT / 2;
    turn(delta);
  };

  const section = MENU[active];

  return (
    <>
      <div
        className={`carousel-stage${dragging ? ' dragging' : ''}`}
        style={{ height: size.h + 40 }}
        onPointerDown={onPointerDown}
        role="group"
        aria-roledescription="carousel"
        aria-label="Menu sections"
      >
        <div
          className="carousel-ring"
          style={{
            width: size.w,
            height: size.h,
            transform: `translateZ(${-radius}px) rotateY(${-(pos + drag) * STEP}deg)`,
          }}
        >
          {MENU.map((sec, i) => {
            const isActive = i === active;
            // How many cards away from the front this one is, round the ring.
            const raw = Math.abs(i - (pos + drag)) % COUNT;
            const distance = Math.min(raw, COUNT - raw);
            return (
              <article
                key={sec.title}
                className={`c-card${isActive ? ' active' : ''}`}
                style={{
                  transform: `rotateY(${i * STEP}deg) translateZ(${radius}px)`,
                  filter: `brightness(${Math.max(0.42, 1 - distance * 0.2)})`,
                }}
                onClick={() => onCardClick(i)}
                aria-hidden={!isActive}
              >
                <div className="c-inner">
                  <header className="c-head">
                    <p className="c-count">
                      {i + 1} / {COUNT}
                    </p>
                    <h2>{sec.title}</h2>
                    <Flourish />
                    {sec.note && <p className="c-note">{sec.note}</p>}
                  </header>

                  <ul className="c-list" tabIndex={isActive ? 0 : -1}>
                    {sec.items.map(([name, price, type, desc]) => (
                      <li key={name}>
                        <div className="item-row">
                          <Mark type={type} />
                          <span className="item-name">{name}</span>
                          <span className="leader" aria-hidden="true" />
                          <span className="item-price">
                            <span className="rupee">₹</span>
                            {price.toLocaleString('en-IN')}
                          </span>
                        </div>
                        {desc && <p className="item-desc">{desc}</p>}
                      </li>
                    ))}
                  </ul>

                  <footer className="c-foot">
                    <button
                      type="button"
                      tabIndex={isActive ? 0 : -1}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!moved.current) onOpenInBook(sectionPage(sec.title));
                      }}
                    >
                      Open in book
                    </button>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="carousel-floor" aria-hidden="true" />

      <nav className="controls" aria-label="Carousel navigation">
        <button type="button" onClick={() => turn(-1)} aria-label="Previous section">
          ‹
        </button>
        <span className="page-label wide" aria-live="polite">
          {section.title} · {section.items.length} dishes
        </span>
        <button type="button" onClick={() => turn(1)} aria-label="Next section">
          ›
        </button>
      </nav>
      <p className="hint">Drag to spin, click a card, or use the arrow keys</p>
    </>
  );
}
