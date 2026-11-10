import { useCallback, useState } from 'react';
import Book from './Book.jsx';
import Carousel from './Carousel.jsx';
import DishView from './DishView.jsx';

const TABS = [
  { id: 'book', label: 'Menu Book' },
  { id: 'carousel', label: '3D Carousel' },
  { id: 'dish', label: '3D Dish' },
];

// "?view=carousel" or "?view=dish" opens that tab; "?page=6" opens the book at a page.
const params = new URLSearchParams(window.location.search);
const START_TAB = TABS.some((t) => t.id === params.get('view')) ? params.get('view') : 'book';
const START_PAGE = Math.max(0, Number(params.get('page')) || 0);

export default function App() {
  const [tab, setTab] = useState(START_TAB);
  // Remembered here so the book reopens where it was left after a tab switch.
  const [bookPage, setBookPage] = useState(START_PAGE);

  const openInBook = useCallback((page) => {
    setBookPage(page);
    setTab('book');
  }, []);

  return (
    <main className="table">
      <div className="tabs" role="tablist" aria-label="Menu view">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'book' && <Book initialPage={bookPage} onPageChange={setBookPage} />}
      {tab === 'carousel' && <Carousel onOpenInBook={openInBook} />}
      {tab === 'dish' && <DishView onOpenInBook={openInBook} />}
    </main>
  );
}
