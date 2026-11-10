// Copies the dishes from the Menu Card app into server/db/seed-data/menu.json,
// so the stock system and the guest-facing menu card share one list of dishes and prices.
//
//   npm run menu:import                      (default: ../Menue Card/src/menu.js)
//   npm run menu:import -- "D:/path/to/menu.js"
//
// Then `npm run db:reset` (fresh install) or edit dishes in the app (live install).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(process.argv[2] || process.env.MENU_CARD_PATH || path.join(here, '../../Menue Card/src/menu.js'));
const out = path.join(here, '../server/db/seed-data/menu.json');

if (!fs.existsSync(src)) {
  console.error(`Menu file not found: ${src}`);
  process.exit(1);
}

const { MENU, RESTAURANT } = await import(pathToFileURL(src).href);
const DIET = { v: 'veg', n: 'nonveg', e: 'egg' };

const data = {
  source: path.relative(path.join(here, '..'), src).split(path.sep).join('/'),
  restaurant: RESTAURANT,
  sections: MENU.map((s, i) => ({
    name: s.title,
    note: s.note || null,
    sort_order: i + 1,
    dishes: s.items.map(([name, price, type, description], j) => {
      if (!DIET[type]) throw new Error(`${name}: unknown type "${type}"`);
      return { name, price, diet: DIET[type], description: description || null, sort_order: j + 1 };
    }),
  })),
};

fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
const count = data.sections.reduce((n, s) => n + s.dishes.length, 0);
console.log(`Imported ${count} dishes in ${data.sections.length} sections from ${src}\n  -> ${out}`);
