const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
};

function issueToken(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  res.cookie(config.cookieName, token, { ...cookieOptions, maxAge: config.cookieMaxAgeMs });
}

function clearToken(res) {
  res.clearCookie(config.cookieName, cookieOptions);
}

function loadUser(req) {
  const token = req.cookies && req.cookies[config.cookieName];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db
      .prepare('SELECT id, name, email, language, token_version, created_at FROM users WHERE id = ?')
      .get(payload.sub);
    if (!user || user.token_version !== payload.tv) return null;
    return user;
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const user = loadUser(req);
  if (!user) {
    clearToken(res);
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  req.user = loadUser(req);
  next();
}

module.exports = { auth, optionalAuth, issueToken, clearToken };
