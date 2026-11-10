import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HTMLFlipBook from 'react-pageflip';
import { MENU, RESTAURANT } from './menu.js';

/* ---------- Pagination ----------
   Each page holds CAPACITY "rows". An item is 1 row (1.65 with a description),
   a section heading is 3 rows (3.7 with a note). Sections flow on to the next
   page with a "continued" heading when they run out of room. */
const CAPACITY = 19.5;
const itemCost = (item) => (item[3] ? 1.65 : 1);

function paginate(menu) {
  const pages = [];
  const startPage = {};
  let blocks = [];
  let used = 0;

  const pushPage = () => {
    if (blocks.length) pages.push(blocks);
    blocks = [];
    used = 0;
  };

  menu.forEach((section) => {
    const headCost = section.note ? 3.7 : 3;
    const firstThree = section.items.slice(0, 3).reduce((s, i) => s + itemCost(i), 0);
    if (used > 0 && used + headCost + firstThree > CAPACITY) pushPage();

    let block = { title: section.title, note: section.note, items: [] };
    blocks.push(block);
    used += headCost;
    startPage[section.title] = pages.length;

    section.items.forEach((item) => {
      const cost = itemCost(item);
      if (used + cost > CAPACITY) {
        pushPage();
        block = { title: section.title, continued: true, items: [] };
        blocks.push(block);
        used += 3;
      }
      block.items.push(item);
      used += cost;
    });
  });
  pushPage();
  return { pages, startPage };
}

const PAGINATED = paginate(MENU);
const FIRST_MENU_INDEX = 4; // cover, endpaper, title page, contents

/** The book page on which a menu section starts. */
export const sectionPage = (title) => FIRST_MENU_INDEX + PAGINATED.startPage[title];

/* ---------- Page-turn sound (synthesised, no audio file) ---------- */
let audioCtx;
function playFlipSound() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const dur = 0.42;
    const len = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) ** 2 * (1 - t * 0.5);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(900, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(3800, audioCtx.currentTime + dur);
    const gain = audioCtx.createGain();
    gain.gain.value = 0.16;
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start();
  } catch {
    /* audio is optional */
  }
}

/* ---------- Page building blocks ---------- */
const Page = forwardRef(function Page({ className = '', hard = false, children }, ref) {
  return (
    <div className={`page ${className}`} ref={ref} data-density={hard ? 'hard' : 'soft'}>
      <div className="page-inner">{children}</div>
    </div>
  );
});

export function Emblem() {
  // A kolam-style rosette drawn with rotated petals.
  const petals = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg className="emblem" viewBox="-60 -60 120 120" aria-hidden="true">
      <circle r="56" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle r="51" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1.5 3" />
      {petals.map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <path d="M0 -8 C 11 -22, 9 -38, 0 -46 C -9 -38, -11 -22, 0 -8 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M0 -16 L0 -38" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="0" cy="-49" r="1.3" fill="currentColor" />
        </g>
      ))}
      {petals.map((a) => (
        <g key={`s${a}`} transform={`rotate(${a + 22.5})`}>
          <path d="M0 -10 C 5 -17, 4 -24, 0 -28 C -4 -24, -5 -17, 0 -10 Z" fill="currentColor" opacity="0.85" />
        </g>
      ))}
      <circle r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle r="2.4" fill="currentColor" />
    </svg>
  );
}

export function Flourish() {
  return (
    <svg className="flourish" viewBox="0 0 200 14" aria-hidden="true">
      <path d="M2 7 H78 M122 7 H198" stroke="currentColor" strokeWidth="0.8" />
      <path d="M100 1 L106 7 L100 13 L94 7 Z" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="100" cy="7" r="1.6" fill="currentColor" />
      <circle cx="84" cy="7" r="1.4" fill="currentColor" />
      <circle cx="116" cy="7" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function Mark({ type }) {
  const label = type === 'v' ? 'Vegetarian' : type === 'e' ? 'Contains egg' : 'Non-vegetarian';
  return <span className={`mark mark-${type}`} role="img" aria-label={label} title={label} />;
}

function MenuBlock({ block }) {
  return (
    <section className="block">
      <header className="block-head">
        <h2>
          {block.title}
          {block.continued && <em> continued</em>}
        </h2>
        <Flourish />
        {block.note && <p className="block-note">{block.note}</p>}
      </header>
      <ul className="items">
        {block.items.map(([name, price, type, desc]) => (
          <li key={name} className="item">
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
    </section>
  );
}

/* ---------- The book ---------- */
export default function Book({ initialPage = 0, onPageChange }) {
  const book = useRef(null);
  // Fixed at mount: the book opens here and then tracks its own page.
  const [startPage] = useState(initialPage);
  const [page, setPage] = useState(startPage);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const goTo = useCallback((index) => book.current?.pageFlip()?.flip(index), []);
  const next = useCallback(() => book.current?.pageFlip()?.flipNext(), []);
  const prev = useCallback(() => book.current?.pageFlip()?.flipPrev(), []);

  // Pages are memoised so react-pageflip is not asked to rebuild the book
  // every time the page counter changes.
  const pages = useMemo(() => {
    const { pages: menuPages } = PAGINATED;

    const list = [
      <Page key="cover" hard className="cover cover-front">
        <div className="cover-frame">
          <p className="cover-est">Est. {RESTAURANT.place}</p>
          <Emblem />
          <h1 className="foil">{RESTAURANT.name}</h1>
          <p className="cover-tag foil">{RESTAURANT.tagline}</p>
          <Flourish />
          <p className="cover-menu foil">Menu</p>
        </div>
      </Page>,

      <Page key="end-front" hard className="endpaper left" />,

      <Page key="title" className="paper right title-page">
        <Emblem />
        <h1>{RESTAURANT.name}</h1>
        <p className="title-tag">{RESTAURANT.tagline}</p>
        <Flourish />
        <p className="title-copy">
          Vanakkam. Our kitchen cooks the food of the South the way it is made at home: idlis steamed
          through the morning, masalas ground on stone, biryani sealed and cooked on dum, and the
          day's catch brought in from the coast.
        </p>
        <p className="title-copy">Turn the page, and eat well.</p>
        <div className="legend">
          <span><Mark type="v" /> Vegetarian</span>
          <span><Mark type="e" /> Contains egg</span>
          <span><Mark type="n" /> Non-vegetarian</span>
        </div>
      </Page>,

      <Page key="contents" className="paper left contents-page">
        <header className="block-head">
          <h2>Contents</h2>
          <Flourish />
        </header>
        <ol className="contents">
          {MENU.map((section) => {
            const index = sectionPage(section.title);
            return (
              <li key={section.title}>
                <button type="button" onClick={() => goTo(index)}>
                  <span className="item-name">{section.title}</span>
                  <span className="leader" aria-hidden="true" />
                  <span className="item-price">{index}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="page-folio">3</p>
      </Page>,

      ...menuPages.map((blocks, i) => {
        const index = FIRST_MENU_INDEX + i;
        return (
          <Page key={`menu-${i}`} className={`paper ${index % 2 ? 'left' : 'right'}`}>
            <p className="running-head">{RESTAURANT.name} · {RESTAURANT.tagline}</p>
            <div className="page-body">
              {blocks.map((block) => (
                <MenuBlock key={block.title + (block.continued ? '-c' : '')} block={block} />
              ))}
            </div>
            <p className="page-folio">{index}</p>
          </Page>
        );
      }),
    ];

    const side = () => (list.length % 2 ? 'left' : 'right');

    list.push(
      <Page key="thanks" className={`paper ${side()} thanks-page`}>
        <Emblem />
        <h2>Nandri</h2>
        <p className="title-tag">Thank you for dining with us</p>
        <Flourish />
        <ul className="fineprint">
          <li>All prices are in Indian Rupees. GST at 5% is added to the bill.</li>
          <li>We do not levy a service charge.</li>
          <li>Seafood and country chicken dishes depend on the day's market.</li>
          <li>Please tell your captain about any food allergy before you order.</li>
          <li>Dishes can be made mild, medium or spicy on request.</li>
        </ul>
      </Page>,
    );

    // The book needs an even page count so the back cover closes on its own.
    // Two more pages follow (endpaper and back cover), so the count must be
    // even here; if it is odd, a specials page fills the gap.
    if (list.length % 2 === 1) {
      list.push(
        <Page key="notes" className={`paper ${side()} notes-page`}>
          <header className="block-head">
            <h2>Today's Specials</h2>
            <Flourish />
            <p className="block-note">Ask your captain</p>
          </header>
          <div className="ruled" />
        </Page>,
      );
    }

    list.push(
      <Page key="end-back" hard className="endpaper right" />,
      <Page key="back" hard className="cover cover-back">
        <div className="cover-frame">
          <Emblem />
          <p className="cover-tag foil">{RESTAURANT.name}</p>
          <Flourish />
          <p className="cover-est">{RESTAURANT.tagline}</p>
          <p className="cover-est">{RESTAURANT.place}</p>
        </div>
      </Page>,
    );
    return list;
  }, [goTo]);

  const total = pages.length;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  const onFlip = useCallback(
    (e) => {
      setPage(e.data);
      onPageChange?.(e.data);
    },
    [onPageChange],
  );
  const onChangeState = useCallback((e) => {
    if (e.data === 'flipping' && soundRef.current) playFlipSound();
  }, []);

  const label =
    page === 0 ? 'Front cover' : page >= total - 1 ? 'Back cover' : `Page ${page} of ${total - 2}`;

  return (
    <>
      <div className="book-wrap">
        <HTMLFlipBook
          ref={book}
          className="book"
          width={480}
          height={680}
          size="stretch"
          minWidth={270}
          maxWidth={560}
          minHeight={382}
          maxHeight={794}
          startPage={startPage}
          showCover
          usePortrait
          mobileScrollSupport
          drawShadow
          maxShadowOpacity={0.55}
          flippingTime={950}
          onFlip={onFlip}
          onChangeState={onChangeState}
        >
          {pages}
        </HTMLFlipBook>
      </div>

      <nav className="controls" aria-label="Menu navigation">
        <button type="button" onClick={prev} disabled={page === 0} aria-label="Previous page">
          ‹
        </button>
        <button type="button" className="text" onClick={() => goTo(3)}>
          Contents
        </button>
        <span className="page-label" aria-live="polite">{label}</span>
        <button
          type="button"
          className="text"
          onClick={() => setSound((s) => !s)}
          aria-pressed={sound}
        >
          Sound {sound ? 'on' : 'off'}
        </button>
        <button type="button" onClick={next} disabled={page >= total - 1} aria-label="Next page">
          ›
        </button>
      </nav>
      <p className="hint">Drag a page corner, click a page edge, or use the arrow keys</p>
    </>
  );
}
