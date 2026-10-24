import sharp from 'sharp';

const BASE = 'http://localhost:3000';
let cookie = '';
let passed = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log('PASS', name);
  } else {
    fails.push(name + (extra ? ': ' + extra : ''));
    console.log('FAIL', name, extra);
  }
}

async function req(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch { /* binary */ }
  return { status: res.status, data };
}

function smoothSkinImage() {
  const size = 400;
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const spot = Math.sin(x / 9) * 6 + Math.cos(y / 13) * 5;
      const blemish = ((x * 7 + y * 11) % 97 === 0) ? -28 : 0;
      buf[i] = Math.min(255, Math.max(0, 205 + spot + blemish));
      buf[i + 1] = Math.min(255, Math.max(0, 160 + spot * 0.7 + blemish));
      buf[i + 2] = Math.min(255, Math.max(0, 140 + spot * 0.5 + blemish));
    }
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

const email = `smoke_${Date.now()}@example.com`;
const password = 'SmokeTest123!';

// health
{
  const { status, data } = await req('/api/health');
  ok('health', status === 200 && data.ok === true && data.version === '2.0', JSON.stringify(data));
}

// signup
{
  const { status, data } = await req('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Smoke Tester', email, password, language: 'en' },
  });
  ok('signup', status === 201 && data.user && data.user.email === email, JSON.stringify(data));
}

// me
{
  const { status, data } = await req('/api/auth/me');
  ok('me', status === 200 && data.user.email === email);
}

// analysis with symptoms
let analysis;
{
  const img = await smoothSkinImage();
  const form = new FormData();
  form.append('image', new Blob([img], { type: 'image/jpeg' }), 'smoke.jpg');
  form.append('symptoms', JSON.stringify(['bleeding_sore']));
  form.append('language', 'en');
  const { status, data } = await req('/api/analysis', { method: 'POST', form });
  analysis = data && data.analysis;
  const r = analysis && analysis.result;
  ok('analysis 201', status === 201 && !!analysis, JSON.stringify(data).slice(0, 200));
  ok('analysis score present', r && Number.isFinite(r.score), r && String(r.score));
  ok('analysis urgency urgent', r && r.urgency && r.urgency.level === 'urgent', r && r.urgency && r.urgency.level);
  ok('analysis has conditions array', r && Array.isArray(r.conditions));
  ok('analysis has routine', r && r.routine && Array.isArray(r.routine.morning));
  ok('analysis local engine', r && r.engine && r.engine.mode === 'local', r && r.engine && r.engine.name);
  ok('analysis care note', r && r.care && typeof r.care.note === 'string');
  ok('analysis disclaimer', r && typeof r.disclaimer === 'string');
}

// emergency redness flag => emergency
{
  const img = await smoothSkinImage();
  const form = new FormData();
  form.append('image', new Blob([img], { type: 'image/jpeg' }), 'smoke.jpg');
  form.append('symptoms', 'breathing,face_swelling');
  const { status, data } = await req('/api/analysis', { method: 'POST', form });
  const r = data && data.analysis && data.analysis.result;
  ok('analysis emergency urgency', status === 201 && r && r.urgency.level === 'emergency', r && r.urgency && r.urgency.level);
  ok('analysis emergency care kind hospital', r && r.care.kind === 'hospital');
}

// list + stats
{
  const { status, data } = await req('/api/analysis');
  ok('analysis list', status === 200 && data.total >= 2 && data.items[0].score !== undefined && data.items[0].urgency);
}
{
  const { status, data } = await req('/api/analysis/stats');
  ok('analysis stats', status === 200 && data.total >= 2 && Array.isArray(data.timeline));
}

// care: emergency by country
{
  const { status, data } = await req('/api/care/emergency?country=IN');
  ok('emergency numbers IN', status === 200 && data.country_code === 'IN' && data.numbers.some((n) => n.number === '112'));
}

// care: nearby by city (network dependent, page must still be valid)
{
  const { status, data } = await req('/api/care/nearby?city=Bengaluru&kind=dermatologist&radius=10&limit=5');
  const valid = status === 200 && data && data.origin && Array.isArray(data.items) && data.emergency_numbers;
  ok('care nearby valid response', valid, JSON.stringify(data).slice(0, 300));
  if (valid) console.log('   care results:', data.count, 'source:', data.source);
}
{
  const { status, data } = await req('/api/care/nearby?kind=hospital');
  ok('care requires location', status === 400 && data.error);
}

// appointment with hospital/phone/maps
{
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { status, data } = await req('/api/appointments', {
    method: 'POST',
    body: {
      type: 'hospital',
      provider: 'Smoke Test Hospital',
      phone: '+91 80 1234 5678',
      address: 'Test Road, Bengaluru',
      care_type: 'hospital',
      maps_url: 'https://www.google.com/maps/dir/?api=1&destination=12.97,77.59',
      date: tomorrow,
      time: '10:30',
      reason: 'SkinSakhi screening: urgent',
    },
  });
  ok('appointment hospital+phone', status === 201 && data.appointment && data.appointment.phone && data.appointment.maps_url, JSON.stringify(data).slice(0, 300));
}

// appointments list
{
  const { status, data } = await req('/api/appointments?type=hospital');
  ok('appointments list', status === 200 && data.items.some((a) => a.provider === 'Smoke Test Hospital' && a.phone));
}

// journal
let noteId;
{
  const { status, data } = await req('/api/journal', { method: 'POST', body: { note: 'Smoke test journal entry', mood: 'okay' } });
  noteId = data && data.entry && data.entry.id;
  ok('journal create', status === 201 && noteId, JSON.stringify(data).slice(0, 200));
}
{
  const { status, data } = await req('/api/journal');
  ok('journal list', status === 200 && data.items.some((e) => e.id === noteId));
}
{
  const { status } = await req(`/api/journal/${noteId}`, { method: 'DELETE' });
  ok('journal delete', status === 200);
}

// products + recommendations
{
  const { status, data } = await req('/api/products?concern=acne');
  ok('products', status === 200 && Array.isArray(data.items) && data.items.length > 0);
}
{
  const { status, data } = await req('/api/recommendations');
  ok('recommendations', status === 200 && Array.isArray(data.products) && data.products.length > 0, JSON.stringify(data).slice(0, 200));
}

// trek checklist
{
  const { status, data } = await req('/api/trek/checklist');
  ok('trek checklist get', status === 200 && Array.isArray(data.items));
}

// cleanup
{
  const { status } = await req('/api/auth/me', { method: 'DELETE', body: { password } });
  ok('account delete', status === 200);
}

console.log(`\n${passed} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:');
  fails.forEach((f) => console.log(' -', f));
  process.exit(1);
}
