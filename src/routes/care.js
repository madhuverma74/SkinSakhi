const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { nearby, emergencyNumbers } = require('../services/care');
const { wrap, httpError } = require('../utils');

// Public services (OSM/Nominatim) are shared, so keep usage modest.
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many location searches. Please try again in a little while.' },
});

const KINDS = ['dermatologist', 'hospital', 'clinic'];

// GET /api/care/nearby?lat=&lon=&kind=dermatologist|hospital|clinic&radius=10&limit=12
// GET /api/care/nearby?city=Bengaluru&kind=hospital
router.get('/nearby', limiter, wrap(async (req, res) => {
  const hasLat = req.query.lat !== undefined && req.query.lat !== '';
  const hasLon = req.query.lon !== undefined && req.query.lon !== '';
  if (hasLat !== hasLon) throw httpError(400, 'Provide both lat and lon, or use a city name.');

  const lat = hasLat ? Number(req.query.lat) : NaN;
  const lon = hasLon ? Number(req.query.lon) : NaN;
  if (hasLat && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw httpError(400, 'Latitude must be between -90 and 90.');
  if (hasLon && (!Number.isFinite(lon) || lon < -180 || lon > 180)) throw httpError(400, 'Longitude must be between -180 and 180.');

  const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 120) : '';
  if (!hasLat && city.length < 2) throw httpError(400, 'Share your location or enter a city.');

  const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'dermatologist';
  const radius = Number(req.query.radius);
  const radiusKm = Number.isFinite(radius) ? Math.min(50, Math.max(1, radius)) : 10;
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 12));

  const data = await nearby({ lat, lon, city, kind, radiusKm, limit });
  res.set('Cache-Control', 'private, max-age=300');
  res.json(data);
}));

// GET /api/care/emergency?country=IN   or ?lat=&lon=
router.get('/emergency', wrap(async (req, res) => {
  let code = typeof req.query.country === 'string' ? req.query.country.toUpperCase().slice(0, 2) : '';
  if (!code && req.query.lat !== undefined && req.query.lon !== undefined) {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const { reverse } = require('../services/care');
      try {
        const rev = await reverse(lat, lon);
        code = (rev && rev.country_code) || '';
      } catch { /* fall through to generic guidance */ }
    }
  }
  res.json(emergencyNumbers(code));
}));

module.exports = router;
