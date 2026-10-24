require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) throw new Error('JWT_SECRET must be set in production.');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set - using a temporary one. Logins reset on every restart.');
}

const dataDir = path.resolve(process.env.DATA_DIR || './data');

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  jwtSecret,
  jwtExpiresIn: '7d',
  cookieName: 'ss_token',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  // Optional Python service that runs the notebook's .keras models (see ml-service/).
  modelServiceUrl: process.env.MODEL_SERVICE_URL || '',
  // Optional Google Places key for richer care results; OSM works without it.
  googlePlacesKey: process.env.GOOGLE_PLACES_API_KEY || '',
  osmUserAgent: process.env.OSM_USER_AGENT || 'SkinSakhi/1.0 (hackathon project; contact: local-user)',
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
};
