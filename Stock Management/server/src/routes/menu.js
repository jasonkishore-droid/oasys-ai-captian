// Menu sections, dishes and their recipes.
const express = require('express');
const { z } = require('zod');
const { HttpError, notFound, idParam } = require('../errors');
const { DIETS } = require('../constants');
const { listDishes, getDish } = require('../services/menu');

const recipeSchema = z.array(z.object({
  ingredient_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().max(1000),
})).max(60);

const dishFields = {
  name: z.string().trim().min(1).max(120),
  section_id: z.coerce.number().int().positive(),
  price: z.coerce.number().min(0).max(1e6),
  diet: z.enum(DIETS),
  description: z.string().trim().max(255).optional().nullable().transform((v) => v || null),
  available: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(10000),
  recipe: recipeSchema,
};
const createSchema = z.object({ ...dishFields, available: dishFields.available.default(true), sort_order: dishFields.sort_order.default(999), recipe: recipeSchema.default([]) });
const updateSchema = z.object({ ...dishFields, active: z.boolean() }).partial();

module.exports = function menuRoutes(db, { requireRole }) {
  const router = express.Router();
  const manager = requireRole('manager');

  const writeRecipe = async (trx, dishId, recipe) => {
    const ids = recipe.map((r) => r.ingredient_id);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'An ingredient appears twice in the recipe');
    if (ids.length) {
      const found = await trx('ingredients').whereIn('id', ids).count({ n: '*' }).first();
      if (Number(found.n) !== ids.length) throw new HttpError(400, 'Recipe uses an ingredient that does not exist');
    }
    await trx('recipe_lines').where({ dish_id: dishId }).del();
    if (recipe.length) await trx('recipe_lines').insert(recipe.map((r) => ({ dish_id: dishId, ...r })));
  };

  router.get('/sections', async (_req, res) => {
    res.json(await db('menu_sections').select('*').orderBy('sort_order'));
  });

  // Everything the POS and the menu manager need in one call.
  router.get('/dishes', async (req, res) => {
    res.json(await listDishes(db, { includeInactive: req.query.include_inactive === 'true' }));
  });

  router.get('/dishes/:id', async (req, res) => {
    const dish = await getDish(db, idParam(req.params.id, 'Dish'));
    if (!dish) throw notFound('Dish');
    res.json(dish);
  });

  router.post('/dishes', manager, async (req, res) => {
    const { recipe, ...data } = createSchema.parse(req.body || {});
    const id = await db.transaction(async (trx) => {
      const now = new Date().toISOString();
      const [{ id }] = await trx('dishes').insert({ ...data, created_at: now, updated_at: now }).returning('id');
      await writeRecipe(trx, id, recipe);
      return id;
    });
    res.status(201).json(await getDish(db, id));
  });

  router.put('/dishes/:id', manager, async (req, res) => {
    const id = idParam(req.params.id, 'Dish');
    const { recipe, ...data } = updateSchema.parse(req.body || {});
    await db.transaction(async (trx) => {
      const n = await trx('dishes').where({ id }).update({ ...data, updated_at: new Date().toISOString() });
      if (!n) throw notFound('Dish');
      if (recipe) await writeRecipe(trx, id, recipe);
    });
    res.json(await getDish(db, id));
  });

  // Captains/cashiers can 86 a dish during service.
  router.patch('/dishes/:id/availability', async (req, res) => {
    const id = idParam(req.params.id, 'Dish');
    const { available } = z.object({ available: z.boolean() }).parse(req.body || {});
    const n = await db('dishes').where({ id }).update({ available, updated_at: new Date().toISOString() });
    if (!n) throw notFound('Dish');
    res.json(await getDish(db, id));
  });

  // Dishes on past bills are archived rather than deleted.
  router.delete('/dishes/:id', manager, async (req, res) => {
    const id = idParam(req.params.id, 'Dish');
    const sold = await db('bill_items').where({ dish_id: id }).first('id');
    const n = sold
      ? await db('dishes').where({ id }).update({ active: false, updated_at: new Date().toISOString() })
      : await db('dishes').where({ id }).del();
    if (!n) throw notFound('Dish');
    res.json({ ok: true, archived: !!sold });
  });

  return router;
};
