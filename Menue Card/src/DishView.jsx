import { Suspense, lazy } from 'react';
import { Flourish, Mark, sectionPage } from './Book.jsx';

// three.js is only downloaded when this tab is opened.
const Dish3D = lazy(() => import('./Dish3D.jsx'));

export default function DishView({ onOpenInBook }) {
  return (
    <section className="dish-stage" aria-label="Chicken Chettinad in 3D">
      <div className="dish-view">
        <Suspense fallback={<p className="dish-loading">Plating…</p>}>
          <Dish3D />
        </Suspense>
        <span className="dish-hint">Drag to turn · scroll to zoom</span>
      </div>

      <aside className="dish-info">
        <p className="c-count">Chef's Signature</p>
        <h2>Chicken Chettinad</h2>
        <Flourish />
        <p className="dish-desc">
          Chicken slow-cooked in a stone-ground roast of kalpasi, marathi mokku, star anise, dried
          red chillies, pepper and coconut, finished with curry leaves and coriander.
        </p>
        <ul className="dish-facts">
          <li>
            <span>Type</span>
            <span><Mark type="n" /> Non-vegetarian</span>
          </li>
          <li><span>Spice</span><span>Medium hot</span></li>
          <li><span>Serves</span><span>Two</span></li>
          <li><span>Pairs with</span><span>Malabar parotta, appam, ghee rice</span></li>
        </ul>
        <p className="dish-price">
          <span className="rupee">₹</span>290
        </p>
        <footer className="c-foot">
          <button type="button" onClick={() => onOpenInBook(sectionPage('Non-Vegetarian Gravies'))}>
            Open in book
          </button>
        </footer>
      </aside>
    </section>
  );
}
