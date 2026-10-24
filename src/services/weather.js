const { httpError } = require('../utils');

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch {
    throw httpError(502, 'The weather service could not be reached. Please try again.');
  }
  if (!res.ok) throw httpError(502, 'The weather service is unavailable right now.');
  return res.json();
}

async function geocode(name) {
  const url =
    'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
    encodeURIComponent(name);
  const data = await getJson(url);
  const g = data.results && data.results[0];
  if (!g) return null;
  return {
    name: g.name,
    region: g.admin1 || '',
    country: g.country || '',
    latitude: g.latitude,
    longitude: g.longitude,
    elevation: Number.isFinite(g.elevation) ? Math.round(g.elevation) : 0,
  };
}

async function forecast(lat, lon) {
  const url =
    'https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=7' +
    `&latitude=${lat}&longitude=${lon}` +
    '&daily=uv_index_max,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max';
  const data = await getJson(url);
  const d = data.daily;
  if (!d || !Array.isArray(d.time)) throw httpError(502, 'The weather service returned unexpected data.');
  return d.time.map((date, i) => ({
    date,
    uv_max: d.uv_index_max[i] ?? 0,
    temp_max: d.temperature_2m_max[i],
    temp_min: d.temperature_2m_min[i],
    rain_prob: d.precipitation_probability_max[i] ?? 0,
    wind_max: d.wind_speed_10m_max[i] ?? 0,
  }));
}

function uvLabel(uv) {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

// UV rises roughly 10% per 1,000 m of altitude, so adjust the model's value for the trail.
function buildTips(day, altitude) {
  const uv = Math.round(day.uv_max * (1 + (0.1 * altitude) / 1000) * 10) / 10;
  const tips = [];

  if (uv >= 3) {
    tips.push('Apply broad-spectrum sunscreen (SPF 30+, SPF 50 is better at altitude) 15-20 minutes before you start. Reapply every 2 hours, sooner if you sweat a lot.');
  } else {
    tips.push('UV is low, but if you will be out for hours, still put sunscreen on exposed skin.');
  }
  if (uv >= 6) tips.push('UV is high: plan the most exposed sections for early morning or late afternoon and rest in shade around midday.');
  if (uv >= 3) tips.push('Wear a wide-brim hat, UV-rated sunglasses and light long sleeves. Do not forget your ears and the back of your neck.');
  tips.push('Use an SPF lip balm and reapply it often.');
  tips.push('Carry plenty of water (roughly 500 ml per hour of hiking in warm weather) and drink before you feel thirsty.');
  if (day.temp_max >= 30) tips.push('It will be hot: take extra water, rest in shade, and watch for dizziness or headache.');
  if (day.temp_min <= 5) tips.push('It will be cold: apply a rich moisturizer to face and hands to prevent chapping, and protect your cheeks from windburn.');
  if (day.wind_max >= 30) tips.push('Strong wind expected: it dries and irritates skin, so a buff or scarf over the face helps.');
  if (day.rain_prob >= 50) tips.push('Rain is likely: choose a water-resistant sunscreen and pack a waterproof layer.');
  if (altitude >= 2500) tips.push('At this altitude the air is thin and dry and UV is stronger, so be extra careful with sun protection and hydration.');
  return { uv_adjusted: uv, uv_label: uvLabel(uv), tips };
}

module.exports = { geocode, forecast, buildTips, uvLabel };
