// Dietary filters (F3) on the client: the words the guest can ask for, the same as
// Menue Card/src/dietary.js (DIETS, AVOID), and how a filter is shown and sent to /api/oasys/menu.
export const DIETS = ['veg', 'egg', 'vegan', 'jain']
export const AVOIDS = ['onion', 'garlic', 'onion-garlic', 'rootveg', 'gluten', 'dairy', 'egg', 'nuts', 'peanut', 'treenut', 'sesame', 'soy', 'fish', 'shellfish', 'seafood']
// avoids that are about allergies (not preference or religion): the answer always tells the guest to tell the staff
export const ALLERGY_AVOIDS = new Set(['gluten', 'dairy', 'egg', 'nuts', 'peanut', 'treenut', 'sesame', 'soy', 'fish', 'shellfish', 'seafood'])

// { diet, avoid } from a tool call, or null when it asks for no filter
export function dietFrom({ diet, avoid } = {}) {
  const d = DIETS.includes(String(diet || '').toLowerCase()) ? String(diet).toLowerCase() : null
  const a = [...new Set((Array.isArray(avoid) ? avoid : avoid ? [avoid] : []).map((x) => String(x).toLowerCase().trim()))].filter((x) => AVOIDS.includes(x))
  return d || a.length ? { diet: d, avoid: a } : null
}

// a filter as words for the guest, e.g. "Jain · no onion"
const DIET_LABELS = { veg: 'Vegetarian', egg: 'Vegetarian or egg', vegan: 'Vegan', jain: 'Jain' }
const AVOID_LABELS = { 'onion-garlic': 'onion & garlic', rootveg: 'root vegetables', treenut: 'tree nuts' }
export function dietaryLabel(f) {
  if (!f) return ''
  return [DIET_LABELS[f.diet], ...(f.avoid || []).map((a) => `no ${AVOID_LABELS[a] || a}`)].filter(Boolean).join(' · ')
}

export const dietaryQuery = (f) =>
  new URLSearchParams({ ...(f?.diet && { filter: f.diet }), ...(f?.avoid?.length && { avoid: f.avoid.join(',') }) })
