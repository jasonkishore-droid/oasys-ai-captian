// Thin fetch wrapper. Session is an HttpOnly cookie; a 401 sends the app back to the sign-in screen.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null))}` : '';
  let res;
  try {
    res = await fetch(`${import.meta.env.BASE_URL}api${path}${qs}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the connection and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  return data;
}

const get = (p, query) => request(p, { query });
const post = (p, body) => request(p, { method: 'POST', body: body ?? {} });
const put = (p, body) => request(p, { method: 'PUT', body });
const patch = (p, body) => request(p, { method: 'PATCH', body });
const del = (p) => request(p, { method: 'DELETE', body: {} });

export const api = {
  login: (username, password) => post('/auth/login', { username, password }),
  logout: () => post('/auth/logout'),
  me: () => get('/auth/me'),
  changePassword: (current_password, new_password) => post('/auth/password', { current_password, new_password }),
  settings: () => get('/settings'),
  saveUpi: (data) => put('/settings/upi', data),

  dashboard: () => get('/reports/dashboard'),
  salesReport: (from, to) => get('/reports/sales', { from, to }),
  dishReport: (from, to) => get('/reports/dishes', { from, to }),
  stockReport: (from, to) => get('/reports/stock', { from, to }),

  ingredients: (includeInactive) => get('/ingredients', { include_inactive: includeInactive ? 'true' : undefined }),
  ingredient: (id) => get(`/ingredients/${id}`),
  createIngredient: (data) => post('/ingredients', data),
  updateIngredient: (id, data) => put(`/ingredients/${id}`, data),
  deleteIngredient: (id) => del(`/ingredients/${id}`),
  moveStock: (id, data) => post(`/ingredients/${id}/movements`, data),
  stockCount: (counts, note) => post('/stock-count', { counts, note }),
  movements: (query) => get('/movements', query),

  suppliers: () => get('/suppliers'),
  createSupplier: (data) => post('/suppliers', data),
  updateSupplier: (id, data) => put(`/suppliers/${id}`, data),

  purchases: () => get('/purchases'),
  purchase: (id) => get(`/purchases/${id}`),
  createPurchase: (data) => post('/purchases', data),
  restock: (dryRun) => post('/purchases/restock', { dry_run: !!dryRun }), // low and out-of-stock items; dry run = preview only

  sections: () => get('/sections'),
  dishes: (includeInactive) => get('/dishes', { include_inactive: includeInactive ? 'true' : undefined }),
  dish: (id) => get(`/dishes/${id}`),
  createDish: (data) => post('/dishes', data),
  updateDish: (id, data) => put(`/dishes/${id}`, data),
  setAvailability: (id, available) => patch(`/dishes/${id}/availability`, { available }),
  deleteDish: (id) => del(`/dishes/${id}`),

  bills: (query) => get('/bills', query),
  bill: (id) => get(`/bills/${id}`),
  nextBillNo: () => get('/bills/next-number').then((r) => r.bill_no),
  createBill: (data) => post('/bills', data),
  voidBill: (id, reason) => post(`/bills/${id}/void`, { reason }),
  emailBill: (id, to) => post(`/bills/${id}/email`, { to }),

  printJobClaim: (id) => post(`/print-queue/${id}/claim`).then((r) => r.ok),
  printJobDone: (id, ok, error) => post(`/print-queue/${id}/done`, { ok, error }),
  printerStatus: (tab, status, name) => post('/print-queue/status', { tab, status, name }),

  users: () => get('/users'),
  createUser: (data) => post('/users', data),
  updateUser: (id, data) => patch(`/users/${id}`, data),
};
