const config = require('./config');

const UNITS = ['kg', 'L', 'pcs'];
const INGREDIENT_CATEGORIES = [
  'Grains & Pulses', 'Dairy', 'Oils & Fats', 'Vegetables & Fruit', 'Meat & Poultry',
  'Seafood', 'Spices & Condiments', 'Beverages', 'Desserts & Bakery', 'Consumables',
];
const DIETS = ['veg', 'nonveg', 'egg'];
const ROLES = ['cashier', 'manager', 'admin'];
const ROLE_LEVEL = { cashier: 1, manager: 2, admin: 3 };
const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'];
const PAYMENT_MODES = ['cash', 'upi', 'card'];
const MOVEMENT_TYPES = ['opening', 'purchase', 'sale', 'void', 'wastage', 'adjustment', 'count'];

// Restaurant-local calendar date. Bills and stock movements are filed under it so that
// "today" in reports means today in Chennai, regardless of the server's timezone.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const businessDate = (d = new Date()) => dayFmt.format(d);
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

module.exports = {
  UNITS, INGREDIENT_CATEGORIES, DIETS, ROLES, ROLE_LEVEL, ORDER_TYPES, PAYMENT_MODES, MOVEMENT_TYPES,
  businessDate, addDays,
};
