const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const { geocode, forecast, buildTips } = require('../services/weather');
const { wrap, httpError, str, isDate } = require('../utils');

// Same order as the checkboxes on the page.
const ITEMS = [
  ['sunscreen', 'Sunscreen'],
  ['hydration', 'Water / Hydration'],
  ['sun-protection', 'Sun Protection'],
  ['moisturizer', 'Moisturizer'],
  ['lip-protection', 'Lip Protection'],
];
const KEYS = ITEMS.map((i) => i[0]);

const planLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many trek plans requested. Please try again later.' },
});

router.get('/checklist', auth, wrap(async (req, res) => {
  const rows = db.prepare('SELECT item, checked FROM trek_checklist WHERE user_id = ?').all(req.user.id);
  const state = Object.fromEntries(rows.map((r) => [r.item, !!r.checked]));
  res.json({ items: ITEMS.map(([key, label]) => ({ key, label, checked: !!state[key] })) });
}));

router.put('/checklist', auth, wrap(async (req, res) => {
  const { item, checked } = req.body;
  if (!KEYS.includes(item)) throw httpError(400, 'Unknown checklist item.');
  if (typeof checked !== 'boolean') throw httpError(400, '"checked" must be true or false.');
  db.prepare(
    `INSERT INTO trek_checklist (user_id, item, checked) VALUES (?, ?, ?)
     ON CONFLICT(user_id, item) DO UPDATE SET checked = excluded.checked`
  ).run(req.user.id, item, checked ? 1 : 0);
  res.json({ ok: true });
}));

router.delete('/checklist', auth, wrap(async (req, res) => {
  db.prepare('DELETE FROM trek_checklist WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
}));

// POST /api/trek/plan  { location, date?, altitude? }   (works logged-out; saved if logged in)
router.post('/plan', planLimiter, optionalAuth, wrap(async (req, res) => {
  const location = str(req.body.location, { min: 2, max: 100, name: 'Location' });

  let altitude = null;
  if (req.body.altitude !== undefined && req.body.altitude !== null && req.body.altitude !== '') {
    altitude = Number(req.body.altitude);
    if (!Number.isFinite(altitude) || altitude < 0 || altitude > 9000) {
      throw httpError(400, 'Altitude must be between 0 and 9000 metres.');
    }
  }

  const geo = await geocode(location);
  if (!geo) throw httpError(404, `Could not find "${location}". Try a nearby town, or add the state or country.`);

  const days = await forecast(geo.latitude, geo.longitude);
  const date = req.body.date ? String(req.body.date) : days[0].date;
  if (!isDate(date)) throw httpError(400, 'Date must look like YYYY-MM-DD.');
  const day = days.find((d) => d.date === date);
  if (!day) throw httpError(400, `A forecast is only available from ${days[0].date} to ${days[days.length - 1].date}.`);

  const altitudeUsed = altitude === null ? geo.elevation : altitude;
  const { uv_adjusted, uv_label, tips } = buildTips(day, altitudeUsed);
  const plan = {
    place: [geo.name, geo.region, geo.country].filter(Boolean).join(', '),
    date,
    altitude_used: altitudeUsed,
    altitude_from_user: altitude !== null,
    day,
    uv_adjusted,
    uv_label,
    tips,
  };

  if (req.user) {
    db.prepare('INSERT INTO trek_plans (user_id, place, plan_date, result_json) VALUES (?, ?, ?, ?)')
      .run(req.user.id, plan.place, date, JSON.stringify(plan));
  }
  res.json({ plan });
}));

router.get('/plans', auth, wrap(async (req, res) => {
  const rows = db
    .prepare('SELECT id, place, plan_date, created_at FROM trek_plans WHERE user_id = ? ORDER BY id DESC LIMIT 10')
    .all(req.user.id);
  res.json({ items: rows });
}));

module.exports = router;
