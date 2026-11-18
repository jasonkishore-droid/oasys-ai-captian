// Standard recipes: raw ingredients used per portion of each dish (kg / L / pcs, the ingredient's unit).
//
// Kitchens batch-cook bases (batter, sambar, chutney, kurma, salna), so dishes are written from
// building blocks that are scaled to the portion. Quantities are kitchen-standard estimates for costing
// and theoretical stock; adjust them in the app (Menu & recipes → Edit) after a few stock counts.

// ---------- helpers ----------
const scale = (lines, k) => lines.map(([n, q]) => [n, q * k]);
const add = (...parts) => {
  const m = new Map();
  for (const part of parts) for (const [n, q] of part) m.set(n, (m.get(n) || 0) + q);
  return [...m].map(([n, q]) => [n, Math.round(q * 10000) / 10000]);
};

// ---------- bases (per kg / L / portion as noted) ----------
const TEMPER = [['Sunflower Oil', 0.005], ['Mustard Seeds', 0.001], ['Curry Leaves', 0.002]];
const idliBatter = (kg) => scale([['Idli Rice', 0.55], ['Urad Dal', 0.18], ['Salt', 0.012]], kg);
const dosaBatter = (kg) => scale([['Idli Rice', 0.55], ['Urad Dal', 0.13], ['Chana Dal', 0.01], ['Salt', 0.012]], kg);
const dosa = (kg = 0.13, oil = 0.01) => add(dosaBatter(kg), [['Sunflower Oil', oil]]);
const ravaDosa = () => [['Rava (Sooji)', 0.05], ['Rice Flour', 0.04], ['Maida', 0.01], ['Cumin Seeds', 0.001], ['Black Pepper', 0.001], ['Green Chilli', 0.003], ['Sunflower Oil', 0.02], ['Salt', 0.002]];
const sambar = (L) => scale([
  ['Toor Dal', 0.07], ['Mixed Vegetables', 0.12], ['Shallots', 0.04], ['Tomato', 0.04], ['Tamarind', 0.012],
  ['Sambar Powder', 0.015], ['Sunflower Oil', 0.012], ['Mustard Seeds', 0.002], ['Curry Leaves', 0.002],
  ['Coriander Leaves', 0.003], ['Salt', 0.008],
], L);
const rasam = (L) => scale([
  ['Tomato', 0.08], ['Tamarind', 0.012], ['Rasam Powder', 0.012], ['Toor Dal', 0.015], ['Garlic', 0.005],
  ['Black Pepper', 0.003], ['Cumin Seeds', 0.002], ['Coriander Leaves', 0.004], ['Curry Leaves', 0.002], ['Ghee', 0.005], ['Salt', 0.008],
], L);
const coconutChutney = (k = 1) => scale([['Coconut', 0.12], ['Chana Dal', 0.008], ['Green Chilli', 0.003], ['Ginger', 0.002], ['Salt', 0.002], ['Sunflower Oil', 0.003], ['Mustard Seeds', 0.001]], k);
const tomatoChutney = (k = 1) => scale([['Tomato', 0.04], ['Onion', 0.02], ['Red Chilli Powder', 0.002], ['Sunflower Oil', 0.004], ['Salt', 0.002]], k);
const SIDES = add(sambar(0.12), coconutChutney(), tomatoChutney());
const potatoMasala = (kg) => scale([
  ['Potato', 0.75], ['Onion', 0.2], ['Green Chilli', 0.02], ['Ginger', 0.01], ['Turmeric Powder', 0.002],
  ['Mustard Seeds', 0.003], ['Sunflower Oil', 0.03], ['Curry Leaves', 0.005], ['Salt', 0.01],
], kg);
const vegKurma = (kg) => scale([
  ['Mixed Vegetables', 0.5], ['Onion', 0.15], ['Tomato', 0.1], ['Coconut', 0.5], ['Cashew Nuts', 0.02], ['Ginger Garlic Paste', 0.02],
  ['Garam Masala', 0.005], ['Fennel Seeds', 0.003], ['Sunflower Oil', 0.05], ['Coriander Leaves', 0.01], ['Salt', 0.01],
], kg);
const vegStew = (kg) => scale([
  ['Mixed Vegetables', 0.3], ['Potato', 0.2], ['Coconut', 1], ['Onion', 0.1], ['Green Chilli', 0.02], ['Ginger', 0.01],
  ['Coconut Oil', 0.03], ['Curry Leaves', 0.005], ['Black Pepper', 0.003], ['Salt', 0.01],
], kg);
const avial = (kg) => scale([
  ['Mixed Vegetables', 0.6], ['Coconut', 0.6], ['Curd', 0.15], ['Green Chilli', 0.02], ['Cumin Seeds', 0.004],
  ['Coconut Oil', 0.03], ['Curry Leaves', 0.01], ['Salt', 0.01],
], kg);
const onionRaita = (k = 1) => scale([['Onion', 0.03], ['Curd', 0.06], ['Coriander Leaves', 0.002], ['Salt', 0.001]], k);
const parotta = (n = 1) => scale([['Maida', 0.07], ['Sunflower Oil', 0.015], ['Sugar', 0.002], ['Milk', 0.01], ['Salt', 0.001]], n);
const vada = (k = 1) => scale([['Urad Dal', 0.03], ['Onion', 0.005], ['Green Chilli', 0.0015], ['Black Pepper', 0.0005], ['Curry Leaves', 0.001], ['Sunflower Oil', 0.015], ['Salt', 0.001]], k);
const uthappam = (...toppings) => add(dosaBatter(0.18), [['Sunflower Oil', 0.015]], ...toppings);

// Meat/fish preparations, written per kg of the main item and scaled to the portion.
const fry65 = (main, kg) => add([[main, kg]], scale([
  ['Ginger Garlic Paste', 0.06], ['Red Chilli Powder', 0.03], ['Corn Flour', 0.05], ['Rice Flour', 0.03], ['Eggs', 2],
  ['Sunflower Oil', 0.25], ['Salt', 0.015], ['Lemon', 1],
], kg), [['Curry Leaves', 0.005], ['Green Chilli', 0.01]]);
const chettinadDry = (main, kg) => add([[main, kg]], scale([
  ['Shallots', 0.4], ['Tomato', 0.2], ['Chettinad Masala', 0.05], ['Black Pepper', 0.01], ['Ginger Garlic Paste', 0.05],
  ['Gingelly Oil', 0.1], ['Turmeric Powder', 0.004], ['Salt', 0.015],
], kg), [['Curry Leaves', 0.008]]);
const pepperDry = (main, kg) => add([[main, kg]], scale([
  ['Onion', 0.4], ['Black Pepper', 0.03], ['Ginger Garlic Paste', 0.05], ['Fennel Seeds', 0.005], ['Turmeric Powder', 0.004],
  ['Sunflower Oil', 0.1], ['Salt', 0.015],
], kg), [['Curry Leaves', 0.008]]);
const gravy = (main, kg) => add([[main, kg]], scale([
  ['Onion', 0.45], ['Tomato', 0.35], ['Ginger Garlic Paste', 0.06], ['Red Chilli Powder', 0.025], ['Coriander Powder', 0.03],
  ['Turmeric Powder', 0.005], ['Garam Masala', 0.012], ['Sunflower Oil', 0.12], ['Salt', 0.02],
], kg), [['Coriander Leaves', 0.01], ['Curry Leaves', 0.005]]);
const tandoori = (main, kg) => add([[main, kg]], scale([
  ['Curd', 0.2], ['Tandoori Masala', 0.04], ['Ginger Garlic Paste', 0.05], ['Red Chilli Powder', 0.01], ['Lemon', 2],
  ['Butter', 0.03], ['Salt', 0.015],
], kg), [['Onion', 0.03], ['Mint Leaves', 0.005]]);
const indoChinese = (main, kg) => add([[main, kg]], scale([
  ['Corn Flour', 0.08], ['Maida', 0.05], ['Sunflower Oil', 0.25], ['Salt', 0.01],
], kg), [['Soy Sauce', 0.012], ['Chilli Sauce', 0.015], ['Tomato Ketchup', 0.01], ['Capsicum', 0.05], ['Onion', 0.06], ['Garlic', 0.008], ['Green Chilli', 0.005]]);
const fishFry = (main, kg) => add([[main, kg]], scale([
  ['Red Chilli Powder', 0.04], ['Turmeric Powder', 0.005], ['Ginger Garlic Paste', 0.05], ['Rice Flour', 0.05], ['Lemon', 2],
  ['Sunflower Oil', 0.25], ['Salt', 0.02],
], kg), [['Curry Leaves', 0.004]]);
const biryaniBase = () => [
  ['Seeraga Samba Rice', 0.16], ['Onion', 0.1], ['Tomato', 0.06], ['Curd', 0.04], ['Mint Leaves', 0.008], ['Coriander Leaves', 0.006],
  ['Ginger Garlic Paste', 0.02], ['Biryani Masala', 0.008], ['Ghee', 0.015], ['Sunflower Oil', 0.015], ['Green Chilli', 0.006],
  ['Lemon', 0.25], ['Salt', 0.006],
];
const biryani = (main, qty) => add(biryaniBase(), [[main, qty]], onionRaita());
const meals = (k = 1) => add(
  [['Ponni Raw Rice', 0.18 * k]],
  sambar(0.15 * k), rasam(0.12 * k), [['Curd', 0.1 * k]],
  scale([['Moong Dal', 0.015], ['Mixed Vegetables', 0.06], ['Coconut', 0.08]], k), // kootu
  scale([['Cabbage', 0.07], ['Coconut', 0.05]], k), TEMPER, // poriyal
  [['Appalam', 1]],
);
const payasam = (k = 1) => scale([['Vermicelli', 0.02], ['Milk', 0.08], ['Sugar', 0.02], ['Cashew Nuts', 0.003], ['Ghee', 0.004], ['Cardamom', 0.0002]], k);
const friedRice = (...extra) => add([
  ['Ponni Raw Rice', 0.14], ['Mixed Vegetables', 0.05], ['Cabbage', 0.02], ['Capsicum', 0.015], ['Onion', 0.02],
  ['Soy Sauce', 0.008], ['Garlic', 0.005], ['Black Pepper', 0.001], ['Sunflower Oil', 0.02], ['Salt', 0.003],
], ...extra);
const noodles = (...extra) => add([
  ['Hakka Noodles', 0.12], ['Cabbage', 0.03], ['Carrot', 0.02], ['Capsicum', 0.02], ['Onion', 0.02], ['Soy Sauce', 0.01],
  ['Chilli Sauce', 0.008], ['Garlic', 0.005], ['Sunflower Oil', 0.025], ['Vinegar', 0.004], ['Salt', 0.003],
], ...extra);
const kothu = (...extra) => add(parotta(2), [['Onion', 0.05], ['Tomato', 0.04], ['Sunflower Oil', 0.02], ['Red Chilli Powder', 0.004], ['Garam Masala', 0.002], ['Curry Leaves', 0.002], ['Salt', 0.003]], ...extra);

// ---------- dishes (names exactly as on the Menu Card) ----------
const RECIPES = {
  // Breakfast & Tiffin
  'Idli (2 pcs)': add(idliBatter(0.1), SIDES),
  'Mini Sambar Idli (14 pcs)': add(idliBatter(0.14), sambar(0.25), [['Ghee', 0.005], ['Coriander Leaves', 0.002]]),
  'Ghee Podi Idli': add(idliBatter(0.15), [['Idli Podi', 0.02], ['Ghee', 0.02], ['Gingelly Oil', 0.005]], coconutChutney()),
  'Rava Idli': add([['Rava (Sooji)', 0.07], ['Curd', 0.04], ['Cashew Nuts', 0.004], ['Carrot', 0.01], ['Green Chilli', 0.003], ['Ghee', 0.005], ['Salt', 0.002]], TEMPER, SIDES),
  'Kanchipuram Idli': add(idliBatter(0.15), [['Black Pepper', 0.002], ['Cumin Seeds', 0.002], ['Ginger', 0.003], ['Cashew Nuts', 0.004], ['Ghee', 0.008]], SIDES),
  'Thatte Idli': add(idliBatter(0.16), [['Ghee', 0.005]], SIDES),
  'Medu Vada (2 pcs)': add(vada(2), SIDES),
  'Sambar Vada': add(vada(2), sambar(0.2), [['Onion', 0.01]]),
  'Rasam Vada': add(vada(2), rasam(0.2)),
  'Thayir Vada': add(vada(2), [['Curd', 0.15], ['Carrot', 0.01], ['Coriander Leaves', 0.002], ['Green Chilli', 0.002], ['Salt', 0.001]], TEMPER),
  'Masala Vada (2 pcs)': add([['Chana Dal', 0.07], ['Onion', 0.03], ['Green Chilli', 0.004], ['Fennel Seeds', 0.002], ['Curry Leaves', 0.002], ['Sunflower Oil', 0.03], ['Salt', 0.002]], coconutChutney()),
  'Ven Pongal': add([['Ponni Raw Rice', 0.07], ['Moong Dal', 0.035], ['Ghee', 0.02], ['Black Pepper', 0.002], ['Cumin Seeds', 0.002], ['Cashew Nuts', 0.005], ['Ginger', 0.003], ['Curry Leaves', 0.001], ['Salt', 0.003]], sambar(0.12), coconutChutney()),
  'Rava Kichadi': add([['Rava (Sooji)', 0.07], ['Mixed Vegetables', 0.05], ['Onion', 0.03], ['Tomato', 0.02], ['Ghee', 0.01], ['Cashew Nuts', 0.004], ['Green Chilli', 0.003], ['Salt', 0.003]], TEMPER, coconutChutney()),
  'Semiya Upma': add([['Vermicelli', 0.07], ['Onion', 0.03], ['Mixed Vegetables', 0.03], ['Sunflower Oil', 0.008], ['Green Chilli', 0.003], ['Salt', 0.003]], TEMPER, coconutChutney()),
  'Idiyappam (3 pcs)': [['Rice Flour', 0.09], ['Coconut', 0.25], ['Sugar', 0.015], ['Salt', 0.001]],
  'Appam (2 pcs)': add([['Ponni Raw Rice', 0.08], ['Coconut', 0.2], ['Sugar', 0.005], ['Salt', 0.002]], vegStew(0.15)),
  'Puttu with Kadala Curry': [['Rice Flour', 0.1], ['Coconut', 0.2], ['Black Kadala', 0.05], ['Onion', 0.03], ['Tomato', 0.02], ['Coconut Oil', 0.01], ['Coriander Powder', 0.005], ['Red Chilli Powder', 0.003], ['Curry Leaves', 0.001], ['Salt', 0.003]],
  'Poori Masala': add([['Wheat Atta', 0.08], ['Sunflower Oil', 0.04], ['Salt', 0.001]], potatoMasala(0.15)),
  'Chapathi with Kurma': add([['Wheat Atta', 0.09], ['Sunflower Oil', 0.01], ['Salt', 0.001]], vegKurma(0.15)),
  'Mini Tiffin': add(idliBatter(0.05), vada(1), dosa(0.07, 0.005), [['Ponni Raw Rice', 0.03], ['Moong Dal', 0.015], ['Ghee', 0.015], ['Black Pepper', 0.001]], [['Rava (Sooji)', 0.02], ['Sugar', 0.02], ['Ghee', 0.008]], SIDES),

  // Dosa varieties
  'Plain Dosa': add(dosa(), SIDES),
  'Masala Dosa': add(dosa(0.14), potatoMasala(0.1), SIDES),
  'Ghee Roast': add(dosa(0.15, 0), [['Ghee', 0.025]], SIDES),
  'Paper Roast': add(dosa(0.18, 0.015), [['Ghee', 0.005]], SIDES),
  'Ghee Podi Roast': add(dosa(0.15, 0), [['Ghee', 0.02], ['Idli Podi', 0.02]], SIDES),
  'Onion Dosa': add(dosa(0.14), [['Onion', 0.06], ['Green Chilli', 0.004], ['Coriander Leaves', 0.002]], SIDES),
  'Rava Dosa': add(ravaDosa(), SIDES),
  'Onion Rava Masala Dosa': add(ravaDosa(), [['Onion', 0.05]], potatoMasala(0.1), SIDES),
  'Coconut Rava Masala Dosa': add(ravaDosa(), [['Coconut', 0.2]], potatoMasala(0.1), SIDES),
  'Mysore Masala Dosa': add(dosa(0.15), [['Shallots', 0.02], ['Garlic', 0.005], ['Red Chilli Powder', 0.004], ['Butter', 0.01]], potatoMasala(0.1), SIDES),
  'Set Dosa (3 pcs)': add(dosa(0.18), vegKurma(0.1), coconutChutney()),
  'Kal Dosa (2 pcs)': add(dosa(0.16), SIDES),
  'Pesarattu': add([['Whole Green Gram', 0.07], ['Ponni Raw Rice', 0.015], ['Ginger', 0.004], ['Green Chilli', 0.004], ['Onion', 0.02], ['Cumin Seeds', 0.001], ['Sunflower Oil', 0.012], ['Salt', 0.002]], coconutChutney()),
  'Adai Avial': add([['Ponni Raw Rice', 0.04], ['Toor Dal', 0.015], ['Chana Dal', 0.015], ['Urad Dal', 0.01], ['Moong Dal', 0.01], ['Red Chilli Powder', 0.002], ['Shallots', 0.015], ['Curry Leaves', 0.001], ['Sunflower Oil', 0.015], ['Salt', 0.002]], avial(0.12)),
  'Paneer Dosa': add(dosa(0.14), [['Paneer', 0.06], ['Onion', 0.03], ['Capsicum', 0.02], ['Tomato', 0.02], ['Garam Masala', 0.002], ['Butter', 0.008]], SIDES),
  'Cheese Dosa': add(dosa(0.14), [['Cheese', 0.04], ['Butter', 0.008]], SIDES),
  'Ragi Dosa': add([['Ragi Flour', 0.06], ['Rice Flour', 0.02], ['Onion', 0.02], ['Green Chilli', 0.003], ['Sunflower Oil', 0.012], ['Salt', 0.002]], SIDES),
  'Muttai Dosa': add(dosa(0.14), [['Eggs', 2], ['Onion', 0.02], ['Black Pepper', 0.001]], SIDES),
  'Kari Dosa': add(dosa(0.15), [['Mutton Kheema', 0.1], ['Onion', 0.04], ['Ginger Garlic Paste', 0.008], ['Red Chilli Powder', 0.004], ['Garam Masala', 0.002], ['Eggs', 1], ['Sunflower Oil', 0.02]], tomatoChutney()),
  'Chicken Kheema Dosa': add(dosa(0.15), [['Chicken Boneless', 0.1], ['Onion', 0.04], ['Ginger Garlic Paste', 0.008], ['Red Chilli Powder', 0.004], ['Garam Masala', 0.002], ['Eggs', 1], ['Sunflower Oil', 0.02]], tomatoChutney()),

  // Uthappam & Paniyaram
  'Plain Uthappam': uthappam(SIDES),
  'Onion Uthappam': uthappam([['Onion', 0.06], ['Green Chilli', 0.004], ['Coriander Leaves', 0.002]], SIDES),
  'Tomato Uthappam': uthappam([['Tomato', 0.06], ['Onion', 0.02]], SIDES),
  'Mixed Veg Uthappam': uthappam([['Carrot', 0.02], ['Onion', 0.03], ['Cabbage', 0.015], ['Green Peas', 0.01], ['Coriander Leaves', 0.002]], SIDES),
  'Podi Uthappam': uthappam([['Idli Podi', 0.02], ['Ghee', 0.01]], SIDES),
  'Egg Uthappam': uthappam([['Eggs', 2], ['Onion', 0.03]], SIDES),
  'Kuzhi Paniyaram': add(idliBatter(0.16), [['Shallots', 0.02], ['Green Chilli', 0.003], ['Sunflower Oil', 0.02]], coconutChutney()),

  // Parotta & breads
  'Parotta (1 pc)': parotta(1),
  'Malabar Parotta (1 pc)': [['Maida', 0.075], ['Ghee', 0.008], ['Sunflower Oil', 0.01], ['Milk', 0.015], ['Sugar', 0.002], ['Salt', 0.001]],
  'Wheat Parotta (1 pc)': [['Wheat Atta', 0.08], ['Sunflower Oil', 0.015], ['Salt', 0.001]],
  'Veg Kothu Parotta': kothu([['Mixed Vegetables', 0.05]], vegKurma(0.08)),
  'Egg Kothu Parotta': kothu([['Eggs', 2]], vegKurma(0.06)),
  'Chicken Kothu Parotta': kothu([['Chicken Boneless', 0.1], ['Eggs', 1], ['Ginger Garlic Paste', 0.008]]),
  'Mutton Kothu Parotta': kothu([['Mutton Boneless', 0.1], ['Eggs', 1], ['Ginger Garlic Paste', 0.008]]),
  'Chilli Parotta': add(parotta(2), [['Capsicum', 0.03], ['Onion', 0.05], ['Soy Sauce', 0.01], ['Chilli Sauce', 0.015], ['Tomato Ketchup', 0.015], ['Corn Flour', 0.01], ['Sunflower Oil', 0.04], ['Garlic', 0.005]]),
  'Ceylon Veechu Parotta': [['Maida', 0.09], ['Onion', 0.02], ['Ghee', 0.01], ['Sunflower Oil', 0.015], ['Green Chilli', 0.002], ['Salt', 0.001]],
  'Bun Parotta (1 pc)': [['Maida', 0.09], ['Sunflower Oil', 0.02], ['Sugar', 0.004], ['Milk', 0.02], ['Salt', 0.001]],
  'Egg Lappa': [['Maida', 0.07], ['Eggs', 2], ['Onion', 0.02], ['Sunflower Oil', 0.02], ['Black Pepper', 0.001], ['Salt', 0.001]],
  'Butter Naan / Garlic Naan': [['Maida', 0.09], ['Curd', 0.015], ['Butter', 0.012], ['Garlic', 0.003], ['Sugar', 0.003], ['Salt', 0.001]],
  'Tandoori Roti / Kulcha': [['Wheat Atta', 0.09], ['Butter', 0.004], ['Salt', 0.001]],

  // Vegetarian starters
  'Gobi 65': [['Cauliflower', 0.25], ['Corn Flour', 0.03], ['Rice Flour', 0.02], ['Red Chilli Powder', 0.006], ['Ginger Garlic Paste', 0.01], ['Curry Leaves', 0.002], ['Sunflower Oil', 0.06], ['Salt', 0.004], ['Lemon', 0.25]],
  'Gobi Manchurian': indoChinese('Cauliflower', 0.25),
  'Paneer 65': [['Paneer', 0.18], ['Corn Flour', 0.025], ['Rice Flour', 0.015], ['Red Chilli Powder', 0.006], ['Ginger Garlic Paste', 0.01], ['Curd', 0.02], ['Sunflower Oil', 0.06], ['Curry Leaves', 0.002], ['Salt', 0.003]],
  'Pepper Mushroom': [['Mushroom', 0.25], ['Onion', 0.07], ['Black Pepper', 0.006], ['Ginger Garlic Paste', 0.008], ['Curry Leaves', 0.002], ['Sunflower Oil', 0.025], ['Coriander Leaves', 0.003], ['Salt', 0.004]],
  'Baby Corn Fry': [['Baby Corn', 0.2], ['Corn Flour', 0.03], ['Maida', 0.015], ['Red Chilli Powder', 0.005], ['Ginger Garlic Paste', 0.008], ['Sunflower Oil', 0.06], ['Salt', 0.003]],
  'Chilli Paneer': indoChinese('Paneer', 0.18),
  'Vazhaipoo Vada': [['Banana Flower', 0.5], ['Chana Dal', 0.06], ['Onion', 0.03], ['Fennel Seeds', 0.002], ['Green Chilli', 0.003], ['Curry Leaves', 0.002], ['Sunflower Oil', 0.04], ['Salt', 0.003]],
  'Onion Pakoda': [['Onion', 0.12], ['Besan', 0.06], ['Rice Flour', 0.015], ['Green Chilli', 0.003], ['Curry Leaves', 0.002], ['Red Chilli Powder', 0.002], ['Sunflower Oil', 0.05], ['Salt', 0.003]],
  'Bajji Platter': add([['Raw Banana', 1], ['Potato', 0.08], ['Besan', 0.08], ['Rice Flour', 0.015], ['Green Chilli', 0.04], ['Red Chilli Powder', 0.003], ['Sunflower Oil', 0.07], ['Salt', 0.003]], coconutChutney()),

  // Chicken starters
  'Chicken 65': fry65('Chicken Boneless', 0.25),
  'Chicken Lollipop (6 pcs)': add(fry65('Chicken Wings', 0.36), [['Chilli Sauce', 0.015]]),
  'Pepper Chicken Dry': pepperDry('Chicken Boneless', 0.25),
  'Chicken Chukka': chettinadDry('Chicken Curry Cut', 0.28),
  'Chilli Chicken': indoChinese('Chicken Boneless', 0.25),
  'Chicken Pallipalayam': [['Chicken Boneless', 0.25], ['Shallots', 0.08], ['Coconut', 0.25], ['Red Chilli Powder', 0.008], ['Curry Leaves', 0.005], ['Gingelly Oil', 0.03], ['Garlic', 0.01], ['Turmeric Powder', 0.001], ['Salt', 0.004]],
  'Nattu Kozhi Varuval': chettinadDry('Country Chicken', 0.3),
  'Tandoori Chicken (Half)': tandoori('Chicken Curry Cut', 0.45),
  'Tandoori Chicken (Full)': tandoori('Chicken Curry Cut', 0.9),
  'Tandoori Pepper Chicken': add(tandoori('Chicken Curry Cut', 0.45), [['Black Pepper', 0.008]]),
  'Chicken Tikka': add(tandoori('Chicken Boneless', 0.25), [['Capsicum', 0.03], ['Onion', 0.03]]),
  'Grilled Chicken Al Faham (Half)': [['Chicken Curry Cut', 0.45], ['Garam Masala', 0.008], ['Black Pepper', 0.004], ['Ginger Garlic Paste', 0.02], ['Curd', 0.03], ['Lemon', 0.5], ['Sunflower Oil', 0.02], ['Garlic', 0.01], ['Salt', 0.006]],
  'Pepper BBQ Chicken': add(tandoori('Chicken Curry Cut', 0.45), [['Black Pepper', 0.008], ['Butter', 0.01]]),
  'Tandoori Platter': add(tandoori('Chicken Boneless', 0.2), tandoori('Basa Fillet', 0.15), tandoori('Prawns', 0.15)),
  'Kaadai Roast': [['Quail', 1], ['Chettinad Masala', 0.015], ['Shallots', 0.05], ['Ginger Garlic Paste', 0.01], ['Gingelly Oil', 0.03], ['Curry Leaves', 0.003], ['Black Pepper', 0.002], ['Salt', 0.003]],

  // Mutton starters
  'Mutton Chukka': chettinadDry('Mutton Boneless', 0.16),
  'Mutton Pepper Fry': pepperDry('Mutton Boneless', 0.16),
  'Kola Urundai (6 pcs)': [['Mutton Kheema', 0.15], ['Chana Dal', 0.02], ['Coconut', 0.1], ['Fennel Seeds', 0.003], ['Shallots', 0.03], ['Garam Masala', 0.003], ['Ginger Garlic Paste', 0.008], ['Eggs', 0.5], ['Sunflower Oil', 0.06], ['Salt', 0.003]],
  'Mutton Brain Fry': [['Mutton Brain', 1], ['Onion', 0.05], ['Black Pepper', 0.004], ['Red Chilli Powder', 0.003], ['Turmeric Powder', 0.001], ['Ginger Garlic Paste', 0.006], ['Curry Leaves', 0.002], ['Sunflower Oil', 0.02], ['Salt', 0.003]],
  'Mutton Liver Fry': [['Mutton Liver', 0.2], ['Onion', 0.06], ['Black Pepper', 0.004], ['Red Chilli Powder', 0.004], ['Ginger Garlic Paste', 0.008], ['Sunflower Oil', 0.025], ['Curry Leaves', 0.002], ['Salt', 0.003]],
  'Mutton Raan': [['Mutton Leg (Raan)', 1.0], ['Curd', 0.2], ['Ginger Garlic Paste', 0.08], ['Garam Masala', 0.02], ['Red Chilli Powder', 0.02], ['Fresh Cream', 0.05], ['Butter', 0.05], ['Lemon', 1], ['Onion', 0.2], ['Sunflower Oil', 0.05], ['Salt', 0.02]],

  // From the sea
  'Vanjaram Tawa Fry (1 slice)': fishFry('Seer Fish (Vanjaram)', 0.18),
  'Fish 65': fry65('Basa Fillet', 0.22),
  'Fish Finger': [['Basa Fillet', 0.2], ['Maida', 0.03], ['Eggs', 1], ['Bread Loaf', 0.15], ['Black Pepper', 0.002], ['Ginger Garlic Paste', 0.006], ['Sunflower Oil', 0.06], ['Tomato Ketchup', 0.02], ['Salt', 0.003]],
  'Nethili Fry': fishFry('Anchovies (Nethili)', 0.22),
  'Pomfret Fry': fishFry('Pomfret', 0.25),
  'Prawn 65': fry65('Prawns', 0.2),
  'Golden Fried Prawns': [['Prawns', 0.2], ['Maida', 0.03], ['Corn Flour', 0.03], ['Eggs', 1], ['Bread Loaf', 0.1], ['Black Pepper', 0.002], ['Sunflower Oil', 0.07], ['Tomato Ketchup', 0.02], ['Salt', 0.003]],
  'Prawn Pepper Fry': pepperDry('Prawns', 0.2),
  'Chettinad Crab Roast': chettinadDry('Crab', 0.35),
  'Crab Lollipop (4 pcs)': [['Crab', 0.3], ['Corn Flour', 0.04], ['Eggs', 1], ['Bread Loaf', 0.1], ['Ginger Garlic Paste', 0.01], ['Red Chilli Powder', 0.005], ['Sunflower Oil', 0.07], ['Salt', 0.003]],
  'Kanava Fry': fry65('Squid', 0.22),
  'Karimeen Pollichathu': [['Pearl Spot (Karimeen)', 1], ['Banana Leaf', 1], ['Shallots', 0.06], ['Tomato', 0.04], ['Ginger Garlic Paste', 0.01], ['Red Chilli Powder', 0.008], ['Turmeric Powder', 0.001], ['Coconut Oil', 0.03], ['Curry Leaves', 0.003], ['Coconut', 0.1], ['Lemon', 0.5], ['Salt', 0.004]],
  'Tandoori Pomfret': tandoori('Pomfret', 0.25),
  'Jumbo Seafood Platter': add(fishFry('Seer Fish (Vanjaram)', 0.18), fry65('Prawns', 0.2), chettinadDry('Crab', 0.35), fry65('Squid', 0.15)),

  // Egg dishes
  'Omelette': [['Eggs', 2], ['Onion', 0.03], ['Green Chilli', 0.003], ['Black Pepper', 0.001], ['Sunflower Oil', 0.01], ['Salt', 0.001]],
  'Kalakki': [['Eggs', 2], ['Onion', 0.01], ['Sunflower Oil', 0.008], ['Black Pepper', 0.001], ['Salt', 0.001]],
  'Half Boil': [['Eggs', 2], ['Black Pepper', 0.001], ['Sunflower Oil', 0.004], ['Salt', 0.001]],
  'Egg Podimas': [['Eggs', 3], ['Onion', 0.04], ['Green Chilli', 0.003], ['Turmeric Powder', 0.0005], ['Sunflower Oil', 0.012], ['Curry Leaves', 0.001], ['Coconut', 0.05], ['Salt', 0.001]],
  'Egg Masala': [['Eggs', 2], ['Onion', 0.08], ['Tomato', 0.06], ['Ginger Garlic Paste', 0.01], ['Red Chilli Powder', 0.005], ['Coriander Powder', 0.004], ['Garam Masala', 0.002], ['Sunflower Oil', 0.025], ['Curry Leaves', 0.001], ['Coriander Leaves', 0.002], ['Salt', 0.003]],
  'Egg Curry': [['Eggs', 2], ['Onion', 0.07], ['Tomato', 0.06], ['Coconut', 0.15], ['Ginger Garlic Paste', 0.01], ['Red Chilli Powder', 0.005], ['Coriander Powder', 0.005], ['Fennel Seeds', 0.002], ['Sunflower Oil', 0.025], ['Salt', 0.003]],

  // Vegetarian gravies
  'Veg Kurma': vegKurma(0.3),
  'Paneer Butter Masala': [['Paneer', 0.16], ['Tomato', 0.15], ['Onion', 0.06], ['Cashew Nuts', 0.015], ['Butter', 0.025], ['Fresh Cream', 0.03], ['Red Chilli Powder', 0.005], ['Garam Masala', 0.003], ['Ginger Garlic Paste', 0.01], ['Sugar', 0.005], ['Salt', 0.003]],
  'Kadai Paneer': [['Paneer', 0.16], ['Capsicum', 0.06], ['Onion', 0.08], ['Tomato', 0.1], ['Ginger Garlic Paste', 0.01], ['Coriander Powder', 0.006], ['Red Chilli Powder', 0.005], ['Garam Masala', 0.003], ['Sunflower Oil', 0.025], ['Fresh Cream', 0.01], ['Coriander Leaves', 0.002], ['Salt', 0.003]],
  'Mushroom Chettinad': [['Mushroom', 0.2], ['Shallots', 0.06], ['Tomato', 0.08], ['Coconut', 0.2], ['Chettinad Masala', 0.012], ['Ginger Garlic Paste', 0.01], ['Gingelly Oil', 0.025], ['Curry Leaves', 0.002], ['Salt', 0.003]],
  'Kadai Vegetable': [['Mixed Vegetables', 0.2], ['Capsicum', 0.05], ['Onion', 0.07], ['Tomato', 0.1], ['Ginger Garlic Paste', 0.01], ['Coriander Powder', 0.006], ['Garam Masala', 0.003], ['Sunflower Oil', 0.025], ['Fresh Cream', 0.01], ['Salt', 0.003]],
  'Dal Tadka': [['Toor Dal', 0.07], ['Moong Dal', 0.02], ['Onion', 0.04], ['Tomato', 0.05], ['Garlic', 0.008], ['Cumin Seeds', 0.002], ['Ghee', 0.015], ['Red Chilli Powder', 0.003], ['Turmeric Powder', 0.001], ['Coriander Leaves', 0.002], ['Salt', 0.003]],
  'Ennai Kathirikai': [['Baby Brinjal', 0.2], ['Shallots', 0.05], ['Tamarind', 0.015], ['Coconut', 0.1], ['Red Chilli Powder', 0.006], ['Coriander Powder', 0.006], ['Gingelly Oil', 0.035], ['Jaggery', 0.005], ['Curry Leaves', 0.002], ['Salt', 0.003]],
  'Kerala Veg Stew': vegStew(0.3),
  'Channa Masala': [['Kabuli Chana', 0.09], ['Onion', 0.07], ['Tomato', 0.08], ['Ginger Garlic Paste', 0.01], ['Garam Masala', 0.004], ['Red Chilli Powder', 0.004], ['Coriander Powder', 0.005], ['Sunflower Oil', 0.025], ['Coriander Leaves', 0.002], ['Salt', 0.003]],
  'Aloo Gobi': [['Potato', 0.14], ['Cauliflower', 0.14], ['Onion', 0.05], ['Tomato', 0.06], ['Ginger Garlic Paste', 0.008], ['Cumin Seeds', 0.002], ['Turmeric Powder', 0.001], ['Red Chilli Powder', 0.004], ['Garam Masala', 0.002], ['Sunflower Oil', 0.025], ['Coriander Leaves', 0.002], ['Salt', 0.003]],

  // Non-vegetarian gravies
  'Chicken Chettinad': add(gravy('Chicken Curry Cut', 0.3), [['Chettinad Masala', 0.015], ['Coconut', 0.2], ['Shallots', 0.04]]),
  'Pepper Chicken Gravy': add(gravy('Chicken Curry Cut', 0.3), [['Black Pepper', 0.008]]),
  'Butter Chicken': [['Chicken Boneless', 0.25], ['Tandoori Masala', 0.01], ['Curd', 0.03], ['Tomato', 0.15], ['Butter', 0.03], ['Fresh Cream', 0.04], ['Cashew Nuts', 0.015], ['Ginger Garlic Paste', 0.012], ['Red Chilli Powder', 0.005], ['Sugar', 0.006], ['Garam Masala', 0.003], ['Salt', 0.004]],
  'Chicken Tikka Masala': add(tandoori('Chicken Boneless', 0.25), [['Tomato', 0.12], ['Onion', 0.08], ['Capsicum', 0.03], ['Fresh Cream', 0.03], ['Cashew Nuts', 0.01], ['Garam Masala', 0.003]]),
  'Nattu Kozhi Kuzhambu': add(gravy('Country Chicken', 0.3), [['Coconut', 0.2], ['Shallots', 0.05], ['Gingelly Oil', 0.02], ['Fennel Seeds', 0.003]]),
  'Mutton Chettinad': add(gravy('Mutton Curry Cut', 0.18), [['Chettinad Masala', 0.015], ['Coconut', 0.2], ['Shallots', 0.04]]),
  'Mutton Kurma': add(gravy('Mutton Curry Cut', 0.18), [['Coconut', 0.3], ['Cashew Nuts', 0.015], ['Fennel Seeds', 0.003], ['Curd', 0.03]]),
  'Meen Kuzhambu': [['Basa Fillet', 0.22], ['Tamarind', 0.02], ['Shallots', 0.06], ['Tomato', 0.06], ['Red Chilli Powder', 0.01], ['Coriander Powder', 0.008], ['Turmeric Powder', 0.001], ['Gingelly Oil', 0.03], ['Mustard Seeds', 0.002], ['Curry Leaves', 0.002], ['Garlic', 0.01], ['Coconut', 0.1], ['Salt', 0.004]],
  'Kerala Fish Moilee': [['Basa Fillet', 0.22], ['Coconut', 0.5], ['Onion', 0.06], ['Tomato', 0.04], ['Ginger', 0.008], ['Green Chilli', 0.006], ['Turmeric Powder', 0.001], ['Coconut Oil', 0.025], ['Curry Leaves', 0.002], ['Black Pepper', 0.002], ['Salt', 0.004]],
  'Prawn Thokku': [['Prawns', 0.2], ['Onion', 0.08], ['Tomato', 0.08], ['Ginger Garlic Paste', 0.012], ['Red Chilli Powder', 0.008], ['Coriander Powder', 0.006], ['Garam Masala', 0.003], ['Gingelly Oil', 0.03], ['Curry Leaves', 0.002], ['Salt', 0.004]],
  'Nandu Kuzhambu': [['Crab', 0.3], ['Shallots', 0.06], ['Tomato', 0.08], ['Coconut', 0.25], ['Tamarind', 0.01], ['Chettinad Masala', 0.012], ['Black Pepper', 0.004], ['Gingelly Oil', 0.03], ['Curry Leaves', 0.002], ['Salt', 0.005]],
  'Chicken Salna': [['Chicken Curry Cut', 0.06], ['Onion', 0.04], ['Tomato', 0.04], ['Coconut', 0.1], ['Ginger Garlic Paste', 0.006], ['Red Chilli Powder', 0.004], ['Garam Masala', 0.002], ['Fennel Seeds', 0.002], ['Sunflower Oil', 0.015], ['Salt', 0.003]],

  // Biryani & rice
  'Chicken Biryani': biryani('Chicken Curry Cut', 0.22),
  'Mutton Biryani': biryani('Mutton Curry Cut', 0.16),
  'Prawn Biryani': biryani('Prawns', 0.16),
  'Fish Biryani': biryani('Basa Fillet', 0.18),
  'Egg Biryani': biryani('Eggs', 2),
  'Veg Biryani': add(biryani('Mixed Vegetables', 0.15), [['Paneer', 0.02]]),
  'Kuska': add(biryaniBase(), onionRaita()),
  'Biryani & Chicken 65 Combo': add(biryani('Chicken Curry Cut', 0.18), fry65('Chicken Boneless', 0.12)),
  'Ghee Rice': [['Seeraga Samba Rice', 0.15], ['Ghee', 0.025], ['Onion', 0.03], ['Cashew Nuts', 0.006], ['Raisins', 0.004], ['Cardamom', 0.0005], ['Salt', 0.003]],
  'Sambar Rice': [['Ponni Raw Rice', 0.1], ['Toor Dal', 0.03], ['Mixed Vegetables', 0.06], ['Tamarind', 0.008], ['Sambar Powder', 0.01], ['Ghee', 0.01], ['Shallots', 0.02], ['Sunflower Oil', 0.005], ['Salt', 0.004], ['Appalam', 1]],
  'Bisi Bele Bath': [['Ponni Raw Rice', 0.1], ['Toor Dal', 0.04], ['Mixed Vegetables', 0.06], ['Tamarind', 0.008], ['Sambar Powder', 0.012], ['Ghee', 0.015], ['Cashew Nuts', 0.004], ['Salt', 0.004]],
  'Curd Rice': add([['Ponni Raw Rice', 0.1], ['Curd', 0.15], ['Milk', 0.03], ['Green Chilli', 0.002], ['Ginger', 0.002], ['Coriander Leaves', 0.002], ['Salt', 0.002]], TEMPER),
  'Lemon Rice': [['Ponni Raw Rice', 0.12], ['Lemon', 1.5], ['Chana Dal', 0.005], ['Urad Dal', 0.003], ['Turmeric Powder', 0.001], ['Green Chilli', 0.003], ['Sunflower Oil', 0.012], ['Curry Leaves', 0.002], ['Mustard Seeds', 0.001], ['Salt', 0.003]],
  'Puliyodarai': [['Ponni Raw Rice', 0.12], ['Tamarind', 0.02], ['Gingelly Oil', 0.02], ['Chana Dal', 0.005], ['Urad Dal', 0.003], ['Red Chilli Powder', 0.004], ['Jaggery', 0.004], ['Mustard Seeds', 0.001], ['Curry Leaves', 0.002], ['Salt', 0.003]],
  'Tomato Rice': [['Ponni Raw Rice', 0.12], ['Tomato', 0.1], ['Onion', 0.04], ['Ginger Garlic Paste', 0.006], ['Red Chilli Powder', 0.004], ['Garam Masala', 0.002], ['Sunflower Oil', 0.015], ['Mint Leaves', 0.003], ['Salt', 0.003]],
  'Coconut Rice': [['Ponni Raw Rice', 0.12], ['Coconut', 0.25], ['Chana Dal', 0.005], ['Urad Dal', 0.003], ['Cashew Nuts', 0.005], ['Green Chilli', 0.003], ['Coconut Oil', 0.012], ['Curry Leaves', 0.002], ['Salt', 0.003]],
  'Veg Fried Rice': friedRice(),
  'Egg Fried Rice': friedRice([['Eggs', 2]]),
  'Chicken Fried Rice': friedRice([['Chicken Boneless', 0.08], ['Eggs', 1]]),
  'Veg Noodles': noodles(),
  'Chicken Noodles': noodles([['Chicken Boneless', 0.08], ['Eggs', 1]]),
  'Steamed Ponni Rice': [['Ponni Raw Rice', 0.15]],

  // Meals
  'South Indian Veg Meals': meals(1.3),
  'Mini Meals': meals(0.6),
  'Special Thali': add(meals(1), [['Wheat Atta', 0.05], ['Sunflower Oil', 0.03]], potatoMasala(0.06), [['Ponni Raw Rice', 0.06], ['Lemon', 0.75], ['Turmeric Powder', 0.0005]], payasam()),
  'Banana Leaf Meals': add(meals(1.2), [['Banana Leaf', 1]], payasam(), vada(1)),
  'Chicken Meals': add(meals(1), gravy('Chicken Curry Cut', 0.12)),
  'Fish Meals': add(meals(1), fishFry('Basa Fillet', 0.08), [['Tamarind', 0.01], ['Shallots', 0.03], ['Gingelly Oil', 0.01]]),
  'Mutton Meals': add(meals(1), gravy('Mutton Curry Cut', 0.12)),
  'North Indian Thali': add([['Wheat Atta', 0.12], ['Sunflower Oil', 0.01], ['Ponni Raw Rice', 0.1], ['Cumin Seeds', 0.002], ['Curd', 0.08], ['Onion', 0.03]],
    [['Toor Dal', 0.035], ['Ghee', 0.008], ['Tomato', 0.03], ['Garlic', 0.004]],
    [['Paneer', 0.08], ['Tomato', 0.07], ['Butter', 0.012], ['Fresh Cream', 0.015], ['Cashew Nuts', 0.007], ['Garam Masala', 0.002]],
    [['Gulab Jamun Mix', 0.02], ['Sugar', 0.025], ['Sunflower Oil', 0.008]]),

  // Soups & sides
  'Pepper Rasam': add(rasam(0.2), [['Black Pepper', 0.002]]),
  'Sambar (bowl)': sambar(0.25),
  'Attukal Paya': [['Mutton Trotters', 1], ['Onion', 0.08], ['Tomato', 0.06], ['Coconut', 0.15], ['Ginger Garlic Paste', 0.01], ['Black Pepper', 0.004], ['Red Chilli Powder', 0.005], ['Coriander Powder', 0.006], ['Garam Masala', 0.003], ['Sunflower Oil', 0.02], ['Coriander Leaves', 0.003], ['Salt', 0.004]],
  'Mutton Bone Soup': [['Mutton Bones', 0.2], ['Shallots', 0.03], ['Tomato', 0.03], ['Black Pepper', 0.004], ['Cumin Seeds', 0.002], ['Turmeric Powder', 0.001], ['Ginger Garlic Paste', 0.006], ['Coriander Leaves', 0.003], ['Sunflower Oil', 0.008], ['Salt', 0.003]],
  'Nandu Soup': [['Crab', 0.12], ['Shallots', 0.03], ['Tomato', 0.03], ['Black Pepper', 0.005], ['Garlic', 0.006], ['Cumin Seeds', 0.002], ['Coriander Leaves', 0.003], ['Salt', 0.003]],
  'Chicken Pepper Soup': [['Chicken Curry Cut', 0.1], ['Shallots', 0.03], ['Tomato', 0.03], ['Black Pepper', 0.005], ['Ginger Garlic Paste', 0.006], ['Coriander Leaves', 0.003], ['Sunflower Oil', 0.008], ['Salt', 0.003]],
  'Tomato Soup': [['Tomato', 0.2], ['Onion', 0.02], ['Butter', 0.01], ['Fresh Cream', 0.015], ['Sugar', 0.005], ['Corn Flour', 0.005], ['Bread Loaf', 0.05], ['Black Pepper', 0.001], ['Salt', 0.003]],
  'Sweet Corn Soup': [['Sweet Corn', 0.08], ['Corn Flour', 0.01], ['Carrot', 0.01], ['Cabbage', 0.01], ['Sugar', 0.003], ['Black Pepper', 0.001], ['Sunflower Oil', 0.003], ['Salt', 0.003]],
  'Veg Manchow Soup': [['Cabbage', 0.03], ['Carrot', 0.02], ['Capsicum', 0.015], ['Beans', 0.015], ['Garlic', 0.006], ['Ginger', 0.004], ['Soy Sauce', 0.01], ['Corn Flour', 0.01], ['Hakka Noodles', 0.025], ['Sunflower Oil', 0.02], ['Vinegar', 0.004], ['Salt', 0.003]],
  'Poriyal / Kootu': add([['Cabbage', 0.08], ['Coconut', 0.06], ['Salt', 0.002]], TEMPER),
  'Avial': avial(0.18),
  'Onion Raita': onionRaita(2),
  'Appalam (2 pcs)': [['Appalam', 2], ['Sunflower Oil', 0.02]],

  // Desserts
  'Rava Kesari': [['Rava (Sooji)', 0.04], ['Sugar', 0.05], ['Ghee', 0.02], ['Cashew Nuts', 0.004], ['Raisins', 0.003], ['Cardamom', 0.0003]],
  'Sakkarai Pongal': [['Ponni Raw Rice', 0.05], ['Moong Dal', 0.015], ['Jaggery', 0.07], ['Ghee', 0.02], ['Cashew Nuts', 0.005], ['Raisins', 0.003], ['Cardamom', 0.0003], ['Milk', 0.03]],
  'Semiya Payasam': add(payasam(1.25), [['Milk', 0.05], ['Raisins', 0.003]]),
  'Paruppu Payasam': [['Moong Dal', 0.03], ['Jaggery', 0.05], ['Coconut', 0.2], ['Ghee', 0.008], ['Cashew Nuts', 0.004], ['Cardamom', 0.0003]],
  'Elaneer Payasam': [['Tender Coconut', 1], ['Milk', 0.12], ['Sugar', 0.025], ['Coconut', 0.1], ['Cardamom', 0.0002]],
  'Gulab Jamun (2 pcs)': [['Gulab Jamun Mix', 0.04], ['Sugar', 0.05], ['Sunflower Oil', 0.015], ['Cardamom', 0.0002]],
  'Badam Halwa': [['Almonds', 0.05], ['Sugar', 0.05], ['Ghee', 0.03], ['Milk', 0.05], ['Cardamom', 0.0003]],
  'Carrot Halwa': [['Carrot', 0.15], ['Milk', 0.1], ['Sugar', 0.04], ['Ghee', 0.015], ['Khoa', 0.02], ['Cashew Nuts', 0.004], ['Cardamom', 0.0003]],
  'Bread Halwa': [['Bread Loaf', 0.25], ['Sugar', 0.05], ['Ghee', 0.03], ['Milk', 0.06], ['Cashew Nuts', 0.005], ['Raisins', 0.003]],
  'Mysore Pak (2 pcs)': [['Besan', 0.03], ['Ghee', 0.045], ['Sugar', 0.06]],
  'Rasmalai (2 pcs)': [['Rasmalai', 2]],
  'Ice Cream (2 scoops)': [['Ice Cream', 0.12]],
  'Kulfi': [['Kulfi', 1]],
  'Falooda': [['Milk', 0.15], ['Rose Syrup', 0.025], ['Sabja Seeds', 0.004], ['Vermicelli', 0.015], ['Ice Cream', 0.06], ['Sugar', 0.01]],
  'Sizzling Brownie': [['Brownie', 1], ['Ice Cream', 0.06], ['Chocolate Syrup', 0.03]],

  // Beverages
  'Filter Coffee': [['Filter Coffee Powder', 0.008], ['Milk', 0.1], ['Sugar', 0.012]],
  'Masala Tea': [['Tea Dust', 0.005], ['Milk', 0.08], ['Sugar', 0.012], ['Ginger', 0.002], ['Cardamom', 0.0002]],
  'Badam Milk (hot or cold)': [['Milk', 0.2], ['Almonds', 0.012], ['Sugar', 0.02], ['Cardamom', 0.0003]],
  'Neer Mor': [['Curd', 0.1], ['Green Chilli', 0.002], ['Ginger', 0.002], ['Curry Leaves', 0.001], ['Coriander Leaves', 0.002], ['Salt', 0.002]],
  'Sweet / Salt Lassi': [['Curd', 0.25], ['Sugar', 0.03], ['Cardamom', 0.0002]],
  'Fresh Lime Juice / Soda': [['Lemon', 1.5], ['Sugar', 0.03], ['Soda 300ml', 1], ['Salt', 0.001]],
  'Rose Milk': [['Milk', 0.2], ['Rose Syrup', 0.03], ['Sugar', 0.01]],
  'Jigarthanda': [['Milk', 0.2], ['Almond Gum', 0.005], ['Nannari Syrup', 0.02], ['Ice Cream', 0.06], ['Sugar', 0.015]],
  'Nannari Sarbath': [['Nannari Syrup', 0.04], ['Lemon', 0.5], ['Sabja Seeds', 0.002]],
  'Tender Coconut': [['Tender Coconut', 1]],
  'Fresh Juice': [['Watermelon', 0.35], ['Sugar', 0.02]],
  'Milkshake': [['Milk', 0.25], ['Ice Cream', 0.08], ['Mango Pulp', 0.06], ['Sugar', 0.02]],
  'Mineral Water (1 litre)': [['Mineral Water 1L', 1]],
};

module.exports = { RECIPES };
