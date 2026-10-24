const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');
const { sniffImage } = require('../services/ai');
const { analyzeSkinImage } = require('../services/skinEngine');
const { SYMPTOMS } = require('../services/skinData');
const { wrap, httpError, normLang, parseId, pageParams } = require('../utils');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(httpError(400, 'Please upload a JPG, PNG, WebP or GIF image.'));
    }
    cb(null, true);
  },
});

// AI calls cost money, so cap them per user.
const analyzeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'user-' + req.user.id,
  message: { error: 'You have reached the hourly analysis limit. Please try again later.' },
});

router.use(auth);

// Accept ["bleeding_sore", ...] or a comma-separated string from a multipart form.
function parseSymptoms(raw) {
  if (!raw) return {};
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { list = raw.split(','); }
  }
  if (!Array.isArray(list)) return {};
  const picked = {};
  for (const key of list.slice(0, 20)) {
    const k = String(key).trim();
    if (Object.prototype.hasOwnProperty.call(SYMPTOMS, k)) picked[k] = true;
  }
  return picked;
}

const serialize = (row) => ({
  id: row.id,
  created_at: row.created_at,
  demo: !!row.demo,
  result: JSON.parse(row.result_json),
});

const getOwned = (id, userId) => {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw httpError(404, 'Analysis not found.');
  return row;
};

// POST /api/analysis   (multipart: image, language)
router.post('/', analyzeLimiter, upload.single('image'), wrap(async (req, res) => {
  if (!req.file) throw httpError(400, 'Please attach a photo (form field "image").');
  const mime = sniffImage(req.file.buffer);
  if (!mime) throw httpError(400, 'That file is not a valid image.');
  const language = normLang(req.body.language, req.user.language);
  const symptoms = parseSymptoms(req.body.symptoms);

  const { result, demo } = await analyzeSkinImage({ buffer: req.file.buffer, mime, symptoms });
  result.language = language;

  const filename = crypto.randomBytes(16).toString('hex') + '.' + EXT[mime];
  fs.writeFileSync(path.join(config.uploadDir, filename), req.file.buffer);
  const info = db
    .prepare('INSERT INTO analyses (user_id, image_file, image_mime, result_json, demo) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, filename, mime, JSON.stringify(result), demo ? 1 : 0);
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ analysis: serialize(row) });
}));

// GET /api/analysis?limit=&offset=
router.get('/', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const rows = db
    .prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE user_id = ?').get(req.user.id).n;
  const items = rows.map((r) => {
    const a = serialize(r);
    return {
      id: a.id,
      created_at: a.created_at,
      demo: a.demo,
      summary: a.result.summary,
      score: a.result.score,
      score_label: a.result.score_label,
      urgency: a.result.urgency ? a.result.urgency.level : 'routine',
      concerns: (a.result.concerns || []).map((c) => c.name),
    };
  });
  res.json({ total, items });
}));

// GET /api/analysis/latest
router.get('/latest', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (!row) throw httpError(404, 'No analysis yet. Upload a photo first.');
  res.json({ analysis: serialize(row) });
}));

// GET /api/analysis/stats  - simple progress overview for the journal
router.get('/stats', wrap(async (req, res) => {
  const rows = db
    .prepare('SELECT id, created_at, result_json FROM analyses WHERE user_id = ? ORDER BY id ASC')
    .all(req.user.id);
  const counts = {};
  const timeline = rows.map((r) => {
    const names = JSON.parse(r.result_json).concerns.map((c) => c.category);
    names.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
    return { id: r.id, created_at: r.created_at, concerns: names };
  });
  res.json({
    total: rows.length,
    first_at: rows.length ? rows[0].created_at : null,
    last_at: rows.length ? rows[rows.length - 1].created_at : null,
    concern_counts: counts,
    timeline: timeline.slice(-30),
  });
}));

router.get('/:id', wrap(async (req, res) => {
  res.json({ analysis: serialize(getOwned(parseId(req.params.id), req.user.id)) });
}));

// The photo itself is only served to its owner.
router.get('/:id/image', wrap(async (req, res) => {
  const row = getOwned(parseId(req.params.id), req.user.id);
  res.set('Cache-Control', 'private, max-age=3600');
  res.type(row.image_mime);
  res.sendFile(path.join(config.uploadDir, row.image_file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Image not found.' });
  });
}));

router.delete('/:id', wrap(async (req, res) => {
  const row = getOwned(parseId(req.params.id), req.user.id);
  db.prepare('DELETE FROM analyses WHERE id = ?').run(row.id);
  fs.rmSync(path.join(config.uploadDir, row.image_file), { force: true });
  res.json({ ok: true });
}));

module.exports = router;
