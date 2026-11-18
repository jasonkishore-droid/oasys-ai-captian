// Dietary and allergen tags for every dish in menu.js (F3).
//
// ⚠️ DRAFT, NOT SIGNED OFF. These tags were drafted from typical Chennai
// restaurant recipes, not from Oasys Restaurant's kitchen. Every row must be checked by
// the restaurant owner / head chef before guests can filter on it (plan: D3).
// Run `node scripts/check-dietary.mjs` to validate coverage and write the
// review sheet (dietary-review.csv) for sign-off.
//
// Each dish maps to a space-separated list of tags for the dish itself.
// Default accompaniments are tagged per section in SECTION_SIDES.
// Veg / egg / non-veg already lives in menu.js ('v' | 'e' | 'n').
//
// Not tagged per dish, because nearly every savoury dish has them (tell guests):
//   - mustard seeds, urad dal and curry leaves in the tempering
//   - asafoetida (hing): compounded hing is usually cut with WHEAT flour, so
//     the kitchen must confirm a gluten-free hing before "gluten-free" is offered
//   - shared frying oil and tawa between veg, egg and non-veg dishes

// Allergens (FSSAI list plus sesame) and diet-relevant ingredients.
export const TAG_LABELS = {
  gluten: 'Gluten (wheat, rava, maida, semiya, soy sauce)',
  dairy: 'Milk (milk, curd, ghee, butter, paneer, cheese, cream)',
  egg: 'Egg',
  fish: 'Fish',
  crustacean: 'Crustaceans (prawn, crab)',
  mollusc: 'Molluscs (squid)',
  peanut: 'Peanuts',
  treenut: 'Tree nuts (cashew, almond, pistachio, walnut)',
  sesame: 'Sesame (podi, gingelly paste)',
  soy: 'Soy (soy sauce)',
  onion: 'Onion or shallots',
  garlic: 'Garlic',
  rootveg: 'Root, bulb or fungus (potato, carrot, ginger, yam, mushroom)',
}

export const ALLERGENS = ['gluten', 'dairy', 'egg', 'fish', 'crustacean', 'mollusc', 'peanut', 'treenut', 'sesame', 'soy']

// What comes on the plate by default, by section title in menu.js.
export const SECTION_SIDES = {
  'Breakfast & Tiffin': 'onion garlic rootveg', // sambar, coconut chutney, tomato-onion chutney
  'Dosa Varieties': 'onion garlic rootveg',
  'Uthappam & Paniyaram': 'onion garlic rootveg',
}

export const DIETARY = {
  // Breakfast & Tiffin
  'Idli (2 pcs)': '',
  'Mini Sambar Idli (14 pcs)': 'dairy onion rootveg',
  'Ghee Podi Idli': 'dairy sesame',
  'Rava Idli': 'gluten dairy treenut rootveg',
  'Kanchipuram Idli': 'dairy treenut rootveg',
  'Thatte Idli': '',
  'Medu Vada (2 pcs)': 'onion rootveg',
  'Sambar Vada': 'onion rootveg',
  'Rasam Vada': 'onion garlic rootveg',
  'Thayir Vada': 'dairy onion rootveg',
  'Masala Vada (2 pcs)': 'onion rootveg',
  'Ven Pongal': 'dairy treenut rootveg',
  'Rava Kichadi': 'gluten dairy treenut onion rootveg',
  'Semiya Upma': 'gluten onion rootveg',
  'Idiyappam (3 pcs)': '',
  'Appam (2 pcs)': '',
  'Puttu with Kadala Curry': 'onion garlic rootveg',
  'Poori Masala': 'gluten onion rootveg',
  'Chapathi with Kurma': 'gluten dairy treenut onion garlic rootveg',
  'Mini Tiffin': 'gluten dairy treenut onion rootveg',

  // Dosa Varieties
  'Plain Dosa': '',
  'Masala Dosa': 'onion rootveg',
  'Ghee Roast': 'dairy',
  'Paper Roast': '',
  'Ghee Podi Roast': 'dairy sesame',
  'Onion Dosa': 'onion',
  'Rava Dosa': 'gluten rootveg',
  'Onion Rava Masala Dosa': 'gluten onion rootveg',
  'Coconut Rava Masala Dosa': 'gluten onion rootveg',
  'Mysore Masala Dosa': 'dairy onion garlic rootveg',
  'Set Dosa (3 pcs)': '',
  'Kal Dosa (2 pcs)': '',
  'Pesarattu': 'onion rootveg',
  'Adai Avial': 'dairy onion rootveg',
  'Paneer Dosa': 'dairy onion garlic rootveg',
  'Cheese Dosa': 'dairy',
  'Ragi Dosa': 'onion',
  'Muttai Dosa': 'egg onion',
  'Kari Dosa': 'egg onion garlic rootveg',
  'Chicken Kheema Dosa': 'egg onion garlic rootveg',

  // Uthappam & Paniyaram
  'Plain Uthappam': '',
  'Onion Uthappam': 'onion',
  'Tomato Uthappam': 'onion',
  'Mixed Veg Uthappam': 'onion rootveg',
  'Podi Uthappam': 'dairy sesame',
  'Egg Uthappam': 'egg onion',
  'Kuzhi Paniyaram': 'onion rootveg',

  // Parotta & Breads
  'Parotta (1 pc)': 'gluten',
  'Malabar Parotta (1 pc)': 'gluten',
  'Wheat Parotta (1 pc)': 'gluten',
  'Veg Kothu Parotta': 'gluten onion garlic rootveg',
  'Egg Kothu Parotta': 'gluten egg onion garlic rootveg',
  'Chicken Kothu Parotta': 'gluten egg onion garlic rootveg',
  'Mutton Kothu Parotta': 'gluten egg onion garlic rootveg',
  'Chilli Parotta': 'gluten soy onion garlic rootveg',
  'Ceylon Veechu Parotta': 'gluten',
  'Bun Parotta (1 pc)': 'gluten',
  'Egg Lappa': 'gluten egg onion',
  'Butter Naan / Garlic Naan': 'gluten dairy garlic',
  'Tandoori Roti / Kulcha': 'gluten dairy',

  // Vegetarian Starters
  'Gobi 65': 'gluten garlic rootveg',
  'Gobi Manchurian': 'gluten soy onion garlic rootveg',
  'Paneer 65': 'gluten dairy garlic rootveg',
  'Pepper Mushroom': 'onion garlic rootveg',
  'Baby Corn Fry': 'gluten garlic rootveg',
  'Chilli Paneer': 'gluten dairy soy onion garlic rootveg',
  'Vazhaipoo Vada': 'onion rootveg',
  'Onion Pakoda': 'onion rootveg',
  'Bajji Platter': 'rootveg',

  // Chicken Starters
  'Chicken 65': 'gluten dairy egg garlic rootveg',
  'Chicken Lollipop (6 pcs)': 'gluten egg soy garlic rootveg',
  'Pepper Chicken Dry': 'onion garlic rootveg',
  'Chicken Chukka': 'onion garlic rootveg',
  'Chilli Chicken': 'gluten egg soy onion garlic rootveg',
  'Chicken Pallipalayam': 'onion garlic',
  'Nattu Kozhi Varuval': 'onion garlic rootveg',
  'Tandoori Chicken (Half)': 'dairy garlic rootveg',
  'Tandoori Chicken (Full)': 'dairy garlic rootveg',
  'Tandoori Pepper Chicken': 'dairy garlic rootveg',
  'Chicken Tikka': 'dairy garlic rootveg',
  'Grilled Chicken Al Faham (Half)': 'dairy garlic rootveg',
  'Pepper BBQ Chicken': 'dairy garlic rootveg',
  'Tandoori Platter': 'dairy fish crustacean garlic rootveg',
  'Kaadai Roast': 'onion garlic rootveg',

  // Mutton Starters
  'Mutton Chukka': 'onion garlic rootveg',
  'Mutton Pepper Fry': 'onion garlic rootveg',
  'Kola Urundai (6 pcs)': 'onion garlic rootveg',
  'Mutton Brain Fry': 'onion garlic rootveg',
  'Mutton Liver Fry': 'onion garlic rootveg',
  'Mutton Raan': 'dairy treenut garlic rootveg',

  // From the Sea
  'Vanjaram Tawa Fry (1 slice)': 'fish garlic rootveg',
  'Fish 65': 'fish gluten egg garlic rootveg',
  'Fish Finger': 'fish gluten egg garlic',
  'Nethili Fry': 'fish garlic rootveg',
  'Pomfret Fry': 'fish garlic rootveg',
  'Prawn 65': 'crustacean gluten egg garlic rootveg',
  'Golden Fried Prawns': 'crustacean gluten egg garlic',
  'Prawn Pepper Fry': 'crustacean onion garlic rootveg',
  'Chettinad Crab Roast': 'crustacean onion garlic rootveg',
  'Crab Lollipop (4 pcs)': 'crustacean gluten egg garlic rootveg',
  'Kanava Fry': 'mollusc gluten onion garlic rootveg',
  'Karimeen Pollichathu': 'fish onion garlic rootveg',
  'Tandoori Pomfret': 'fish dairy garlic rootveg',
  'Jumbo Seafood Platter': 'fish crustacean mollusc gluten egg garlic rootveg',

  // Egg Dishes
  'Omelette': 'egg onion',
  'Kalakki': 'egg',
  'Half Boil': 'egg',
  'Egg Podimas': 'egg onion',
  'Egg Masala': 'egg onion garlic rootveg',
  'Egg Curry': 'egg onion garlic rootveg',

  // Vegetarian Gravies
  'Veg Kurma': 'treenut onion garlic rootveg',
  'Paneer Butter Masala': 'dairy treenut onion garlic rootveg',
  'Kadai Paneer': 'dairy onion garlic rootveg',
  'Mushroom Chettinad': 'onion garlic rootveg',
  'Kadai Vegetable': 'dairy onion garlic rootveg',
  'Dal Tadka': 'dairy onion garlic rootveg',
  'Ennai Kathirikai': 'peanut sesame onion garlic',
  'Kerala Veg Stew': 'onion rootveg',
  'Channa Masala': 'onion garlic rootveg',
  'Aloo Gobi': 'onion garlic rootveg',

  // Non-Vegetarian Gravies
  'Chicken Chettinad': 'onion garlic rootveg',
  'Pepper Chicken Gravy': 'onion garlic rootveg',
  'Butter Chicken': 'dairy treenut onion garlic rootveg',
  'Chicken Tikka Masala': 'dairy treenut onion garlic rootveg',
  'Nattu Kozhi Kuzhambu': 'onion garlic rootveg',
  'Mutton Chettinad': 'onion garlic rootveg',
  'Mutton Kurma': 'dairy treenut onion garlic rootveg',
  'Meen Kuzhambu': 'fish onion garlic',
  'Kerala Fish Moilee': 'fish onion garlic rootveg',
  'Prawn Thokku': 'crustacean onion garlic rootveg',
  'Nandu Kuzhambu': 'crustacean onion garlic rootveg',
  'Chicken Salna': 'onion garlic rootveg',

  // Biryani & Rice
  'Chicken Biryani': 'dairy onion garlic rootveg',
  'Mutton Biryani': 'dairy onion garlic rootveg',
  'Prawn Biryani': 'crustacean dairy onion garlic rootveg',
  'Fish Biryani': 'fish dairy onion garlic rootveg',
  'Egg Biryani': 'egg dairy onion garlic rootveg',
  'Veg Biryani': 'dairy onion garlic rootveg',
  'Kuska': 'dairy onion garlic rootveg',
  'Biryani & Chicken 65 Combo': 'gluten dairy egg onion garlic rootveg',
  'Ghee Rice': 'dairy treenut onion',
  'Sambar Rice': 'dairy onion rootveg',
  'Bisi Bele Bath': 'dairy treenut onion rootveg',
  'Curd Rice': 'dairy rootveg',
  'Lemon Rice': 'peanut rootveg',
  'Puliyodarai': 'peanut sesame',
  'Tomato Rice': 'onion garlic rootveg',
  'Coconut Rice': 'treenut',
  'Veg Fried Rice': 'gluten soy onion garlic rootveg',
  'Egg Fried Rice': 'gluten soy egg onion garlic rootveg',
  'Chicken Fried Rice': 'gluten soy egg onion garlic rootveg',
  'Veg Noodles': 'gluten soy onion garlic rootveg',
  'Chicken Noodles': 'gluten soy egg onion garlic rootveg',
  'Steamed Ponni Rice': '',

  // Meals
  'South Indian Veg Meals': 'gluten dairy treenut onion garlic rootveg',
  'Mini Meals': 'dairy onion garlic rootveg',
  'Special Thali': 'gluten dairy treenut peanut onion garlic rootveg',
  'Banana Leaf Meals': 'gluten dairy treenut onion garlic rootveg',
  'Chicken Meals': 'gluten dairy treenut onion garlic rootveg',
  'Fish Meals': 'fish gluten dairy treenut onion garlic rootveg',
  'Mutton Meals': 'gluten dairy treenut onion garlic rootveg',
  'North Indian Thali': 'gluten dairy treenut onion garlic rootveg',

  // Soups & Sides
  'Pepper Rasam': 'garlic',
  'Sambar (bowl)': 'onion rootveg',
  'Attukal Paya': 'onion garlic rootveg',
  'Mutton Bone Soup': 'onion garlic rootveg',
  'Nandu Soup': 'crustacean onion garlic rootveg',
  'Chicken Pepper Soup': 'onion garlic rootveg',
  'Tomato Soup': 'dairy onion garlic',
  'Sweet Corn Soup': 'garlic rootveg',
  'Veg Manchow Soup': 'gluten soy onion garlic rootveg',
  'Poriyal / Kootu': 'onion',
  'Avial': 'dairy rootveg',
  'Onion Raita': 'dairy onion',
  'Appalam (2 pcs)': '',

  // Desserts
  'Rava Kesari': 'gluten dairy treenut',
  'Sakkarai Pongal': 'dairy treenut',
  'Semiya Payasam': 'gluten dairy treenut',
  'Paruppu Payasam': 'dairy treenut',
  'Elaneer Payasam': 'dairy',
  'Gulab Jamun (2 pcs)': 'gluten dairy',
  'Badam Halwa': 'dairy treenut',
  'Carrot Halwa': 'dairy treenut rootveg',
  'Bread Halwa': 'gluten dairy treenut',
  'Mysore Pak (2 pcs)': 'dairy',
  'Rasmalai (2 pcs)': 'dairy treenut',
  'Ice Cream (2 scoops)': 'dairy',
  'Kulfi': 'dairy treenut',
  'Falooda': 'gluten dairy treenut',
  'Sizzling Brownie': 'gluten dairy egg treenut soy',

  // Beverages
  'Filter Coffee': 'dairy',
  'Masala Tea': 'dairy rootveg',
  'Badam Milk (hot or cold)': 'dairy treenut',
  'Neer Mor': 'dairy rootveg',
  'Sweet / Salt Lassi': 'dairy',
  'Fresh Lime Juice / Soda': '',
  'Rose Milk': 'dairy',
  'Jigarthanda': 'dairy',
  'Nannari Sarbath': '',
  'Tender Coconut': '',
  'Fresh Juice': '',
  'Milkshake': 'dairy',
  'Mineral Water (1 litre)': '',
}

// Dishes where recipes vary a lot between kitchens: ask the chef about these first.
export const CHECK = {
  'Ragi Dosa': 'Instant ragi dosa often adds rava (wheat). Gluten?',
  'Chicken Kheema Dosa': 'Is an egg layered on top?',
  'Kuzhi Paniyaram': 'Tagged as the kaaram version. Sweet version has no onion.',
  'Parotta (1 pc)': 'Many kitchens add egg or milk to parotta dough. Confirm for all parottas.',
  'Malabar Parotta (1 pc)': 'Egg or milk in the dough?',
  'Ceylon Veechu Parotta': 'Often has egg. Menu marks it veg.',
  'Bun Parotta (1 pc)': 'Egg or milk in the dough?',
  'Gobi 65': 'Maida in the batter? Curd or food colour in the marinade?',
  'Baby Corn Fry': 'Maida in the batter?',
  'Bajji Platter': 'Fried in the same oil as non-veg starters?',
  'Kola Urundai (6 pcs)': 'Egg used as a binder? Poppy seeds?',
  'Mutton Raan': 'Cashew or almond paste in the marinade?',
  'Kanava Fry': 'Batter-fried (gluten) or masala-fried?',
  'Kuska': 'Cooked in meat stock? Menu marks it veg.',
  'Veg Noodles': 'Egg noodles? Menu marks it veg.',
  'Sweet Corn Soup': 'Made with egg? Cornflour only, or maida?',
  'Ennai Kathirikai': 'Peanut and sesame in the masala paste?',
  'Coconut Rice': 'Cashew or peanut garnish?',
  'Elaneer Payasam': 'Any nuts on top?',
  'Ice Cream (2 scoops)': 'Check brand labels for egg and nuts.',
  'Falooda': 'Jelly made with gelatin (non-veg)? Falooda sev wheat or cornflour?',
  'Bread Halwa': 'Does the bread contain egg?',
  'Jigarthanda': 'Contains ice cream; check brand label for egg and nuts.',
  'Milkshake': 'Ice cream added? Check brand label.',
  'Appalam (2 pcs)': 'Check pack label for hing (wheat).',
}

const has = (set, t) => set.includes(t)

// Owner sign-off: dietary-signoff.json, written by scripts/apply-dietary-review.mjs from the review
// sheet the owner filled in: { signed_by, signed_at, dishes: { [name]: 'tags as confirmed' } }.
// Only dishes in it are confirmed; the rest still carry the draft tags above.

// Full tag picture for one dish as served.
//   name: dish name, type: 'v' | 'e' | 'n' from menu.js, section: section title,
//   signoff: the parsed dietary-signoff.json, if any
//   returns { tags, allergens, vegan, jain, jainWithoutSides, confirmed, check, untagged }
export function dishDiet(name, type, section, signoff = null) {
  const confirmed = !!signoff?.dishes && Object.hasOwn(signoff.dishes, name)
  const own = ((confirmed ? signoff.dishes[name] : DIETARY[name]) ?? '').split(/\s+/).filter(Boolean)
  const sides = ((signoff?.sides && Object.hasOwn(signoff.sides, section) ? signoff.sides[section] : SECTION_SIDES[section]) ?? '').split(/\s+/).filter(Boolean)
  const tags = [...new Set([...own, ...sides, ...(type === 'e' ? ['egg'] : [])])]
  const veg = type === 'v' && !has(tags, 'egg')
  return {
    tags,
    ownTags: own,
    allergens: ALLERGENS.filter((a) => has(tags, a)),
    vegan: veg && !has(tags, 'dairy'),
    // Jain: vegetarian, no egg, no onion, garlic, root vegetables or fungi.
    jain: veg && !has(tags, 'onion') && !has(tags, 'garlic') && !has(tags, 'rootveg'),
    jainWithoutSides: veg && !own.some((t) => t === 'onion' || t === 'garlic' || t === 'rootveg'),
    confirmed,
    check: confirmed ? null : CHECK[name] ?? null,
    untagged: !confirmed && !(name in DIETARY),
  }
}

// What a guest can ask to filter by: a diet, and things to avoid.
export const DIETS = ['veg', 'egg', 'vegan', 'jain'] // egg: vegetarian or egg, no meat or fish
// "avoid" words, each standing for one or more tags
export const AVOID = {
  onion: ['onion'], garlic: ['garlic'], 'onion-garlic': ['onion', 'garlic'], rootveg: ['rootveg'],
  gluten: ['gluten'], dairy: ['dairy'], egg: ['egg'], nuts: ['peanut', 'treenut'], peanut: ['peanut'], treenut: ['treenut'],
  sesame: ['sesame'], soy: ['soy'], fish: ['fish'], shellfish: ['crustacean', 'mollusc'], seafood: ['fish', 'crustacean', 'mollusc'],
}

// Does a dish (from dishDiet, plus its menu type) pass the filter?
//   'yes': as served · 'with-changes': only if the default sides are swapped (Jain, onion/garlic) · 'no'
export function passes(d, type, { diet = null, avoid = [] } = {}) {
  const tagsAvoided = avoid.flatMap((a) => AVOID[a] || [])
  if (diet === 'veg' && type !== 'v') return 'no'
  if (diet === 'egg' && type === 'n') return 'no'
  if (diet === 'vegan' && !d.vegan) return 'no'
  const clash = tagsAvoided.some((t) => d.tags.includes(t))
  if (diet === 'jain' && !d.jain) return d.jainWithoutSides && !clash ? 'with-changes' : 'no'
  if (!clash) return 'yes'
  // onion, garlic and roots that only come with the sides: fine once the sides are swapped
  const sideOnly = (t) => !d.ownTags.includes(t)
  return tagsAvoided.filter((t) => d.tags.includes(t)).every((t) => ['onion', 'garlic', 'rootveg'].includes(t) && sideOnly(t)) ? 'with-changes' : 'no'
}
