class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const httpError = (status, message) => new HttpError(status, message);

// Express 4 does not catch rejected promises on its own.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const LANGS = { en: 'en', english: 'en', hi: 'hi', hindi: 'hi', pa: 'pa', punjabi: 'pa' };
const LANG_NAMES = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
  pa: 'Punjabi (Gurmukhi script)',
};
const normLang = (value, fallback = 'en') =>
  LANGS[String(value || '').trim().toLowerCase()] || fallback;

function str(value, { min = 0, max = 500, name = 'Field' } = {}) {
  if (typeof value !== 'string') {
    if (min > 0) throw httpError(400, `${name} is required.`);
    return '';
  }
  const t = value.trim();
  if (t.length < min) {
    throw httpError(400, min === 1 ? `${name} is required.` : `${name} must be at least ${min} characters.`);
  }
  if (t.length > max) throw httpError(400, `${name} must be at most ${max} characters.`);
  return t;
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const todayUTC = () => new Date().toISOString().slice(0, 10);
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, 'Invalid id.');
  return n;
}

function pageParams(query, defLimit = 20) {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defLimit));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  return { limit, offset };
}

module.exports = {
  HttpError, httpError, wrap, normLang, LANG_NAMES,
  str, isEmail, isDate, isTime, todayUTC, addDays, parseId, pageParams,
};
