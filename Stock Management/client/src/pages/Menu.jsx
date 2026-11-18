import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useLiveStock, useToast, can, DietMark, Modal, Alert, Loading, Empty, Field, Segmented, Stat, StatusBadge } from '../ui.jsx';
import { money, pct, qty, round2, downloadCsv } from '../format';

const SORTS = [['menu', 'Menu order'], ['cost', 'Food cost % ↓'], ['margin', 'Margin ↓'], ['portions', 'Portions ↑']];
const costTone = (p) => (p === null ? '' : p > 40 ? 'danger' : p > 32 ? 'warn' : 'ok');

export default function Menu() {
  const { user, settings } = useApp();
  const manager = can(user, 'manager');
  const toast = useToast();
  const q = useLoad(() => Promise.all([api.dishes(), api.sections()]));
  useLiveStock(q.refresh); // stays up to date when stock changes, including from the kitchen
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('');
  const [sort, setSort] = useState('menu');
  const [onlyOff, setOnlyOff] = useState(false);
  const [editing, setEditing] = useState(null);
  const [restocking, setRestocking] = useState(false);
  const [dishes, sections] = q.data || [[], []];

  const replace = (d) => q.setData(([xs, s]) => [xs.map((x) => (x.id === d.id ? { ...x, ...d } : x)), s]);

  const toggle = async (d) => {
    try {
      const r = await api.setAvailability(d.id, !d.available);
      replace(r);
      toast(`${d.name} is ${r.available ? 'back on' : 'off'} the menu today`);
    } catch (e) { toast(e.message, 'error'); }
  };

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = dishes.filter((d) => (!section || String(d.section_id) === section) && (!s || d.name.toLowerCase().includes(s)) && (!onlyOff || !d.available || d.portions === 0));
    const by = {
      cost: (a, b) => (b.food_cost_pct ?? -1) - (a.food_cost_pct ?? -1),
      margin: (a, b) => b.margin - a.margin,
      portions: (a, b) => (a.portions ?? 1e9) - (b.portions ?? 1e9),
    }[sort];
    return by ? [...list].sort(by) : list;
  }, [dishes, search, section, sort, onlyOff]);

  const avg = useMemo(() => {
    const priced = dishes.filter((d) => d.food_cost_pct !== null);
    return priced.length ? priced.reduce((s, d) => s + d.food_cost_pct, 0) / priced.length : null;
  }, [dishes]);

  const exportCsv = () => downloadCsv(`oasys-menu-costing-${settings.business_date}.csv`, visible, [
    { label: 'Section', value: (d) => d.section }, { label: 'Dish', value: (d) => d.name }, { label: 'Diet', value: (d) => d.diet },
    { label: 'Price (₹)', value: (d) => d.price }, { label: 'Recipe cost (₹)', value: (d) => d.cost },
    { label: 'Food cost %', value: (d) => d.food_cost_pct }, { label: 'Margin (₹)', value: (d) => d.margin },
    { label: 'Portions possible', value: (d) => d.portions }, { label: 'Limited by', value: (d) => d.limited_by },
    { label: 'Available', value: (d) => (d.available ? 'yes' : 'no') },
  ]);

  if (q.loading && !q.data) return <Loading />;

  return (
    <div className="page">
      <section className="stats">
        <Stat label="Dishes on menu" value={dishes.length} />
        <Stat label="Average food cost" value={pct(avg)} sub="Recipe cost ÷ menu price" tone={avg > 35 ? 'warn' : ''} />
        <Stat label="Above 40% food cost" value={dishes.filter((d) => d.food_cost_pct > 40).length} tone="warn" onClick={() => setSort('cost')} active={sort === 'cost'} />
        <Stat label="Off / can't make" value={dishes.filter((d) => !d.available || d.portions === 0).length} tone="danger" onClick={() => setOnlyOff((v) => !v)} active={onlyOff} />
      </section>

      <section className="toolbar">
        <input className="search" placeholder="Search dishes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Segmented value={sort} onChange={setSort} options={SORTS} />
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export CSV</button>
        {manager && <button className="btn" onClick={() => setRestocking(true)} title="Order everything that is low or out of stock">Restock</button>}
        {manager && <button className="btn primary" onClick={() => setEditing({})}>+ Dish</button>}
      </section>

      {q.error && <Alert>{q.error}</Alert>}
      <section className="card">
        {visible.length === 0 ? <Empty>No dishes match.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Dish</th><th>Section</th><th className="num">Price</th><th className="num">Recipe cost</th><th className="num">Food cost</th><th className="num">Margin</th><th className="num">Can make</th><th>Today</th><th /></tr></thead>
              <tbody>
                {visible.map((d) => (
                  <tr key={d.id} className={!d.available ? 'voided' : ''}>
                    <td><div className="dish-cell"><DietMark diet={d.diet} /><div><div className="name">{d.name}</div>{d.description && <div className="sub">{d.description}</div>}</div></div></td>
                    <td className="sub">{d.section}</td>
                    <td className="num">{money(d.price)}</td>
                    <td className="num">{money(d.cost)}<div className="sub">{d.recipe_lines} ingredients</div></td>
                    <td className="num"><span className={`cost-pill ${costTone(d.food_cost_pct)}`}>{pct(d.food_cost_pct)}</span></td>
                    <td className="num">{money(d.margin)}</td>
                    <td className="num">
                      {d.portions === null ? <span className="muted">—</span> : <strong className={d.portions === 0 ? 'danger' : d.portions <= 5 ? 'warn' : ''}>{d.portions}</strong>}
                      {d.limited_by && d.portions !== null && d.portions <= 10 && <div className="sub">{d.limited_by}</div>}
                    </td>
                    <td>
                      <label className="switch" title={d.available ? 'Switch off for today' : 'Switch back on'}>
                        <input type="checkbox" checked={d.available} onChange={() => toggle(d)} />
                        <span className="slider" /><span className="switch-label">{d.available ? 'On' : 'Off'}</span>
                      </label>
                    </td>
                    <td className="actions"><button className="link" onClick={() => setEditing(d)}>{manager ? 'Edit' : 'Recipe'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted small">Food cost uses each ingredient's weighted-average purchase cost. "Can make" is how many portions current book stock covers, limited by the scarcest ingredient.</p>

      {restocking && (
        <RestockModal onClose={() => setRestocking(false)}
          onDone={(r) => { setRestocking(false); q.reload(); toast(`Restocked ${r.count} item${r.count === 1 ? '' : 's'} · ${money(r.total)}`); }} />
      )}
      {editing && (
        <DishForm dish={editing} sections={sections} readOnly={!manager} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); q.reload(); }} />
      )}
    </div>
  );
}

function DishForm({ dish, sections, readOnly, onClose, onSaved }) {
  const isNew = !dish.id;
  const toast = useToast();
  const q = useLoad(() => Promise.all([isNew ? Promise.resolve(null) : api.dish(dish.id), api.ingredients()]), [dish.id]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');

  const [full, ingredients] = q.data || [null, []];
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  if (q.data && !form) {
    setForm(isNew
      ? { name: '', section_id: sections[0]?.id || '', price: '', diet: 'veg', description: '', recipe: [] }
      : { name: full.name, section_id: full.section_id, price: full.price, diet: full.diet, description: full.description || '', recipe: full.recipe.map((r) => ({ ingredient_id: r.ingredient_id, quantity: r.quantity })) });
  }

  if (!form) return <Modal title={isNew ? 'New dish' : dish.name} onClose={onClose}>{q.error ? <Alert>{q.error}</Alert> : <Loading />}</Modal>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, v) => setForm((f) => ({ ...f, recipe: f.recipe.map((r, j) => (j === i ? { ...r, quantity: v } : r)) }));
  const removeLine = (i) => setForm((f) => ({ ...f, recipe: f.recipe.filter((_, j) => j !== i) }));
  const addLine = (id) => {
    if (!id) return;
    setForm((f) => (f.recipe.some((r) => r.ingredient_id === Number(id)) ? f : { ...f, recipe: [...f.recipe, { ingredient_id: Number(id), quantity: '' }] }));
    setPick('');
  };

  const lineCost = (r) => round2(Number(r.quantity || 0) * (ingById.get(r.ingredient_id)?.avg_cost || 0));
  const cost = round2(form.recipe.reduce((s, r) => s + lineCost(r), 0));
  const price = Number(form.price || 0);
  const foodPct = price > 0 ? (cost / price) * 100 : null;
  const portions = form.recipe.length
    ? Math.min(...form.recipe.map((r) => (Number(r.quantity) > 0 ? Math.floor(Math.max(0, ingById.get(r.ingredient_id)?.quantity || 0) / Number(r.quantity)) : Infinity)))
    : null;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      name: form.name, section_id: Number(form.section_id), price, diet: form.diet, description: form.description || null,
      recipe: form.recipe.filter((r) => Number(r.quantity) > 0).map((r) => ({ ingredient_id: r.ingredient_id, quantity: Number(r.quantity) })),
    };
    try {
      if (isNew) await api.createDish(body); else await api.updateDish(dish.id, body);
      toast(`${form.name} saved`);
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.deleteDish(dish.id);
      toast(r.archived ? `${dish.name} removed from the menu (kept on old bills)` : `${dish.name} deleted`);
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'New dish' : readOnly ? `Recipe: ${dish.name}` : `Edit ${dish.name}`} onClose={onClose} size="wide" busy={busy}>
      <form onSubmit={save}>
        <fieldset disabled={readOnly} className="plain">
          <div className="grid four">
            <Field label="Name" full><input value={form.name} onChange={set('name')} required maxLength={120} /></Field>
            <Field label="Section">
              <select value={form.section_id} onChange={set('section_id')}>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Field>
            <Field label="Menu price ₹"><input type="number" min="0" step="1" value={form.price} onChange={set('price')} required /></Field>
            <Field label="Type">
              <select value={form.diet} onChange={set('diet')}><option value="veg">Veg</option><option value="egg">Egg</option><option value="nonveg">Non-veg</option></select>
            </Field>
            <Field label="Description (menu card)"><input value={form.description} onChange={set('description')} maxLength={255} /></Field>
          </div>

          <div className="recipe-head">
            <h3>Recipe per portion</h3>
            <div className="recipe-kpis">
              <span>Cost <strong>{money(cost)}</strong></span>
              <span>Food cost <strong className={`cost-pill ${costTone(foodPct)}`}>{pct(foodPct)}</strong></span>
              <span>Margin <strong>{money(price - cost)}</strong></span>
              <span>Can make <strong>{portions === null || portions === Infinity ? '—' : portions}</strong></span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="compact recipe">
              <thead><tr><th>Ingredient</th><th className="num">Qty per portion</th><th className="num">On hand</th><th className="num">₹/unit</th><th className="num">Line cost</th><th /></tr></thead>
              <tbody>
                {form.recipe.map((r, i) => {
                  const ing = ingById.get(r.ingredient_id);
                  return (
                    <tr key={r.ingredient_id}>
                      <td className="name">{ing?.name || `#${r.ingredient_id}`}</td>
                      <td className="num"><input className="count-input" type="number" min="0" step="any" value={r.quantity} onChange={(e) => setLine(i, e.target.value)} aria-label={`${ing?.name} quantity`} /> {ing?.unit}
                        {Number(r.quantity) > 0 && Number(r.quantity) < 1 && ing?.unit !== 'pcs' && <div className="sub">{qty(r.quantity, ing?.unit)}</div>}
                      </td>
                      <td className="num sub">{ing && qty(ing.quantity, ing.unit, { small: false })}</td>
                      <td className="num sub">{ing && money(ing.avg_cost)}</td>
                      <td className="num">{money(lineCost(r))}</td>
                      <td className="actions">{!readOnly && <button type="button" className="link danger" onClick={() => removeLine(i)} aria-label={`Remove ${ing?.name}`}>Remove</button>}</td>
                    </tr>
                  );
                })}
                {form.recipe.length === 0 && <tr><td colSpan={6} className="muted">No ingredients yet. This dish won't be stock-tracked until it has a recipe.</td></tr>}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <div className="add-line">
              <select value={pick} onChange={(e) => addLine(e.target.value)} aria-label="Add ingredient">
                <option value="">+ Add ingredient…</option>
                {ingredients.filter((i) => !form.recipe.some((r) => r.ingredient_id === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </div>
          )}
        </fieldset>
        {error && <Alert>{error}</Alert>}
        <div className="modal-actions">
          {!isNew && !readOnly && <button type="button" className="btn danger-outline left" onClick={remove} disabled={busy}>Remove from menu</button>}
          <button type="button" className="btn" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save dish'}</button>}
        </div>
      </form>
    </Modal>
  );
}

// Restock: shows what is low or out of stock and what would be ordered, then records the purchase(s).
function RestockModal({ onClose, onDone }) {
  const q = useLoad(() => api.restock(true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = q.data;

  const go = async () => {
    setBusy(true);
    setError('');
    try { onDone(await api.restock(false)); } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title="Restock" size="wide" onClose={onClose} busy={busy}
      actions={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={go} disabled={busy || !r?.count}>{busy ? 'Restocking…' : r?.count ? `Restock ${r.count} item${r.count === 1 ? '' : 's'} · ${money(r.total)}` : 'Restock'}</button>
      </>}>
      {q.error && <Alert>{q.error}</Alert>}
      {!r && !q.error && <Loading />}
      {r && !r.count && <Empty>Everything is above its par level. Nothing to restock.</Empty>}
      {r?.count > 0 && (
        <>
          <p className="muted">Orders the usual reorder quantity of every low or out-of-stock ingredient at its average cost, and adds it to stock as goods received (note "Auto restock"). One purchase is recorded per supplier.</p>
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Ingredient</th><th>Status</th><th className="num">On hand</th><th className="num">Par</th><th className="num">Order</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.ingredient_id}>
                    <td><div className="name">{i.name}</div>{i.supplier && <div className="sub">{i.supplier}</div>}</td>
                    <td><StatusBadge status={i.status} /></td>
                    <td className="num">{qty(i.on_hand, i.unit)}</td>
                    <td className="num">{qty(i.par_level, i.unit)}</td>
                    <td className="num"><strong>{qty(i.quantity, i.unit)}</strong></td>
                    <td className="num">{money(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
