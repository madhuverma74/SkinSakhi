const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { auth, issueToken, clearToken } = require('../middleware/auth');
const { wrap, httpError, str, normLang, isEmail } = require('../utils');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  language: u.language,
  created_at: u.created_at,
});

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) {
    throw httpError(400, 'Password must be between 8 and 128 characters.');
  }
  return p;
}

router.post('/signup', limiter, wrap(async (req, res) => {
  const name = str(req.body.name, { min: 2, max: 80, name: 'Name' });
  const email = str(req.body.email, { min: 3, max: 254, name: 'Email' }).toLowerCase();
  if (!isEmail(email)) throw httpError(400, 'Please enter a valid email address.');
  const password = checkPassword(req.body.password);
  const language = normLang(req.body.language);

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw httpError(409, 'An account with this email already exists.');
  }
  const hash = await bcrypt.hash(password, 12);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, language) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, language);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  issueToken(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw httpError(401, 'Invalid email or password.');
  issueToken(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

router.get('/me', (req, res, next) => {
  // Not "auth": a logged-out visitor is a normal case here, so answer 401 without clearing noise.
  auth(req, res, next);
}, (req, res) => res.json({ user: publicUser(req.user) }));

router.put('/me', auth, wrap(async (req, res) => {
  const name = req.body.name === undefined
    ? req.user.name
    : str(req.body.name, { min: 2, max: 80, name: 'Name' });
  const language = req.body.language === undefined ? req.user.language : normLang(req.body.language, req.user.language);
  db.prepare('UPDATE users SET name = ?, language = ? WHERE id = ?').run(name, language, req.user.id);
  res.json({ user: publicUser({ ...req.user, name, language }) });
}));

router.post('/password', limiter, auth, wrap(async (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = checkPassword(req.body.newPassword);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(current, row.password_hash))) {
    throw httpError(401, 'Current password is incorrect.');
  }
  const hash = await bcrypt.hash(next, 12);
  // Bumping token_version signs the user out everywhere else.
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(hash, req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  issueToken(res, updated);
  res.json({ ok: true });
}));

// Permanently deletes the account, all notes/history and the uploaded photos.
router.delete('/me', limiter, auth, wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(String(req.body.password || ''), row.password_hash))) {
    throw httpError(401, 'Password is incorrect.');
  }
  const files = db.prepare('SELECT image_file FROM analyses WHERE user_id = ?').all(req.user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  for (const f of files) fs.rmSync(path.join(config.uploadDir, f.image_file), { force: true });
  clearToken(res);
  res.json({ ok: true });
}));

module.exports = router;
