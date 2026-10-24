const router = require('express').Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { CATEGORIES } = require('../services/ai');
const { wrap, httpError } = require('../utils');

// GET /api/products?concern=dryness   (public)
router.get('/products', wrap(async (req, res) => {
  const concern = req.query.concern;
  if (concern !== undefined && !CATEGORIES.includes(concern)) {
    throw httpError(400, `Concern must be one of: ${CATEGORIES.join(', ')}.`);
  }
  const items = concern
    ? db.prepare('SELECT * FROM products WHERE concern = ? ORDER BY id').all(concern)
    : db.prepare('SELECT * FROM products ORDER BY concern, id').all();
  res.json({ concern: concern || null, items });
}));

// GET /api/recommendations   - routine, tips and product types based on the latest analysis
router.get('/recommendations', auth, wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (!row) throw httpError(404, 'No analysis yet. Analyze a skin photo first.');
  const result = JSON.parse(row.result_json);

  let categories = [...new Set(result.concerns.map((c) => c.category))];
  if (!categories.length) categories = ['general'];
  const marks = categories.map(() => '?').join(',');
  const products = db
    .prepare(`SELECT * FROM products WHERE concern IN (${marks}) ORDER BY id LIMIT 12`)
    .all(...categories);

  res.json({
    analysis_id: row.id,
    created_at: row.created_at,
    demo: !!row.demo,
    result,
    categories,
    products,
  });
}));

module.exports = router;
