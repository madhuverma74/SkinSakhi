const router = require('express').Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { wrap, httpError, str, isDate, isTime, todayUTC, addDays, parseId } = require('../utils');

const TYPES = ['doctor', 'home', 'clinic', 'hospital'];
const CARE_TYPES = ['dermatologist', 'hospital', 'clinic', 'doctor'];

router.use(auth);

const owned = (id, userId) => {
  const row = db.prepare('SELECT * FROM appointments WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw httpError(404, 'Appointment not found.');
  return row;
};

// GET /api/appointments?filter=upcoming|all
router.get('/', wrap(async (req, res) => {
  const upcoming = req.query.filter === 'upcoming';
  // One day of leeway because the server clock is UTC and the user may be ahead of it.
  const rows = upcoming
    ? db.prepare(
        `SELECT * FROM appointments WHERE user_id = ? AND status = 'requested' AND appt_date >= ?
         ORDER BY appt_date, appt_time`
      ).all(req.user.id, addDays(todayUTC(), -1))
    : db.prepare('SELECT * FROM appointments WHERE user_id = ? ORDER BY appt_date DESC, appt_time DESC LIMIT 100')
        .all(req.user.id);
  res.json({ items: rows });
}));

router.post('/', wrap(async (req, res) => {
  const type = req.body.type;
  if (!TYPES.includes(type)) throw httpError(400, `Type must be one of: ${TYPES.join(', ')}.`);
  const date = req.body.date;
  const time = req.body.time;
  if (!isDate(date)) throw httpError(400, 'Please choose a valid date.');
  if (!isTime(time)) throw httpError(400, 'Please choose a valid time.');
  if (date < addDays(todayUTC(), -1)) throw httpError(400, 'The date cannot be in the past.');
  if (date > addDays(todayUTC(), 365)) throw httpError(400, 'Please choose a date within the next year.');

  const provider = str(req.body.provider, { max: 120, name: 'Provider' });
  const reason = str(req.body.reason, { max: 500, name: 'Reason' });
  const address = str(req.body.address, { max: 250, name: 'Address' });
  const phone = str(req.body.phone, { max: 40, name: 'Phone' });
  if (phone && !/^[+()\d\s./-]{6,40}$/.test(phone)) throw httpError(400, 'Please enter a valid phone number.');
  const careType = CARE_TYPES.includes(req.body.care_type) ? req.body.care_type : null;
  const mapsUrl = str(req.body.maps_url, { max: 500, name: 'Map link' });
  if (mapsUrl && !/^https?:\/\//i.test(mapsUrl)) throw httpError(400, 'The map link is not valid.');
  if (type === 'home' && address.length < 5) throw httpError(400, 'Please enter your home address.');

  const clash = db.prepare(
    "SELECT 1 FROM appointments WHERE user_id = ? AND appt_date = ? AND appt_time = ? AND status = 'requested'"
  ).get(req.user.id, date, time);
  if (clash) throw httpError(409, 'You already have an appointment at that date and time.');

  const info = db.prepare(
    `INSERT INTO appointments (user_id, type, provider, appt_date, appt_time, address, reason, phone, care_type, maps_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.user.id, type, provider || null, date, time,
    type === 'home' ? address : (address || null), reason || null,
    phone || null, careType, mapsUrl || null
  );
  res.status(201).json({ appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid) });
}));

router.patch('/:id/cancel', wrap(async (req, res) => {
  const row = owned(parseId(req.params.id), req.user.id);
  if (row.status === 'cancelled') throw httpError(409, 'That appointment is already cancelled.');
  db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(row.id);
  res.json({ appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(row.id) });
}));

module.exports = router;
