const router = require('express').Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { wrap, httpError, str, parseId, pageParams } = require('../utils');

const MOODS = ['great', 'good', 'okay', 'low', 'irritated'];

router.use(auth);

function readFields(body) {
  const note = str(body.note, { min: 1, max: 2000, name: 'Note' });
  let mood = null;
  if (body.mood !== undefined && body.mood !== null && body.mood !== '') {
    if (!MOODS.includes(body.mood)) throw httpError(400, `Mood must be one of: ${MOODS.join(', ')}.`);
    mood = body.mood;
  }
  return { note, mood };
}

function checkAnalysis(analysisId, userId) {
  if (analysisId === undefined || analysisId === null || analysisId === '') return null;
  const id = parseId(analysisId);
  if (!db.prepare('SELECT 1 FROM analyses WHERE id = ? AND user_id = ?').get(id, userId)) {
    throw httpError(400, 'That analysis does not exist.');
  }
  return id;
}

const owned = (id, userId) => {
  const row = db.prepare('SELECT * FROM journal WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw httpError(404, 'Note not found.');
  return row;
};

router.get('/', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query, 30);
  const items = db
    .prepare('SELECT * FROM journal WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM journal WHERE user_id = ?').get(req.user.id).n;
  res.json({ total, items });
}));

router.post('/', wrap(async (req, res) => {
  const { note, mood } = readFields(req.body);
  const analysisId = checkAnalysis(req.body.analysis_id, req.user.id);
  const info = db
    .prepare('INSERT INTO journal (user_id, analysis_id, note, mood) VALUES (?, ?, ?, ?)')
    .run(req.user.id, analysisId, note, mood);
  res.status(201).json({ entry: db.prepare('SELECT * FROM journal WHERE id = ?').get(info.lastInsertRowid) });
}));

router.put('/:id', wrap(async (req, res) => {
  const row = owned(parseId(req.params.id), req.user.id);
  const { note, mood } = readFields(req.body);
  db.prepare("UPDATE journal SET note = ?, mood = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(note, mood, row.id);
  res.json({ entry: db.prepare('SELECT * FROM journal WHERE id = ?').get(row.id) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const row = owned(parseId(req.params.id), req.user.id);
  db.prepare('DELETE FROM journal WHERE id = ?').run(row.id);
  res.json({ ok: true });
}));

module.exports = router;
