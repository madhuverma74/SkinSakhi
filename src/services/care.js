const config = require('../config');

const USER_AGENT = config.osmUserAgent;
const cache = new Map();
const CACHE_MS = 15 * 60 * 1000;

function cached(key, fn, ttl = CACHE_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) {
    for (const [k, v] of cache) if (Date.now() - v.at > ttl) cache.delete(k);
  }
  return value;
}

const clampLat = (v) => Math.min(90, Math.max(-90, v));
const clampLon = (v) => Math.min(180, Math.max(-180, v));

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

const mapsDirections = (lat, lon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

const mapsSearch = (lat, lon, kind) =>
  `https://www.google.com/maps/search/${encodeURIComponent(
    kind === 'hospital' ? 'hospital emergency' : 'dermatologist skin clinic'
  )}/@${lat},${lon},14z`;

async function nominatim(path, params) {
  const url = new URL('https://nominatim.openstreetmap.org/' + path);
  for (const [k, v] of Object.entries({ ...params, format: 'jsonv2' })) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('location service returned ' + res.status);
  return res.json();
}

// City/area name -> coordinates. Cached for a day because places rarely move.
async function geocode(query) {
  const q = String(query || '').trim().slice(0, 120);
  if (q.length < 2) return null;
  return cached('geo:' + q.toLowerCase(), async () => {
    const results = await nominatim('search', { q, limit: '1', addressdetails: '1' });
    if (!Array.isArray(results) || !results.length) return null;
    const r = results[0];
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat: clampLat(lat),
      lon: clampLon(lon),
      label: r.display_name || q,
      country_code: (r.address && r.address.country_code ? r.address.country_code : '').toUpperCase(),
      city: r.address && (r.address.city || r.address.town || r.address.village || r.address.state) || '',
    };
  }, 24 * 60 * 60 * 1000);
}

async function reverse(lat, lon) {
  const key = `rev:${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    return await cached(key, async () => {
      const r = await nominatim('reverse', { lat: String(lat), lon: String(lon), zoom: '10' });
      return {
        label: r.display_name || '',
        country_code: (r.address && r.address.country_code ? r.address.country_code : '').toUpperCase(),
        city: r.address && (r.address.city || r.address.town || r.address.village || r.address.state) || '',
      };
    }, 24 * 60 * 60 * 1000);
  } catch {
    return null;
  }
}

// ---------- Google Places (optional; only used when a key is configured) ----------

async function googleNearby(lat, lon, radiusM, kind, limit) {
  if (!config.googlePlacesKey) return [];
  const body = {
    textQuery: kind === 'hospital' ? 'hospital emergency department' : 'dermatologist skin clinic',
    maxResultCount: Math.min(20, limit),
    locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(50000, radiusM) } },
  };
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': config.googlePlacesKey,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,' +
        'places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri,' +
        'places.currentOpeningHours.openNow,places.websiteUri',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Google Places returned ' + res.status);
  const data = await res.json();
  return (data.places || [])
    .map((p) => {
      const loc = p.location || {};
      if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
      const distance = haversineKm(lat, lon, loc.latitude, loc.longitude);
      if (distance > radiusM / 1000) return null;
      return {
        name: (p.displayName && p.displayName.text) || 'Unnamed place',
        address: p.formattedAddress || '',
        lat: loc.latitude,
        lon: loc.longitude,
        distance_km: Math.round(distance * 10) / 10,
        phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
        website: p.websiteUri || '',
        opening_hours: '',
        open_now: p.currentOpeningHours ? p.currentOpeningHours.openNow : null,
        emergency: kind === 'hospital',
        kind,
        maps_url: p.googleMapsUri || mapsDirections(loc.latitude, loc.longitude),
        source: 'google',
      };
    })
    .filter(Boolean);
}

// ---------- OpenStreetMap Overpass (free, no key) ----------

function overpassQuery(lat, lon, radiusM, kind) {
  const around = `(around:${radiusM},${lat},${lon})`;
  const derma = [
    `nwr["healthcare:speciality"~"dermatology",i]${around};`,
    `nwr["speciality"~"dermatology",i]${around};`,
    `nwr["healthcare"="doctor"]["name"~"derma|skin|cosmetolog",i]${around};`,
    `nwr["amenity"~"clinic|doctors"]["name"~"derma|skin|cosmetolog",i]${around};`,
  ];
  const hospital = [`nwr["amenity"="hospital"]${around};`, `nwr["healthcare"="hospital"]${around};`];
  const clinic = [`nwr["amenity"~"clinic|doctors"]${around};`, `nwr["healthcare"~"clinic|centre"]${around};`];
  const parts = kind === 'hospital' ? hospital : kind === 'clinic' ? clinic : derma.concat(hospital);
  return `[out:json][timeout:20];(${parts.join('')});out center tags 60;`;
}

async function overpass(lat, lon, radiusM, kind) {
  const query = overpassQuery(lat, lon, radiusM, kind);
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  let lastErr;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
        body: new URLSearchParams({ data: query }),
        // Public Overpass mirrors are often slow. Fail over quickly rather than
        // making the user wait a minute for a result.
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error('Overpass returned ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass unavailable');
}

// Fallback for when every Overpass mirror is down: Nominatim's place search is
// much lighter and usually answers in a second or two. It returns fewer POIs
// than Overpass, but something usable is better than an error page.
async function nominatimPlaces(lat, lon, radiusM, kind) {
  const latDelta = radiusM / 111320;
  const lonDelta = radiusM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const viewbox = [lon - lonDelta, lat + latDelta, lon + lonDelta, lat - latDelta]
    .map((v) => v.toFixed(5))
    .join(',');
  const query = kind === 'hospital' ? 'hospital' : 'skin clinic';
  const results = await nominatim('search', {
    q: query,
    viewbox,
    bounded: '1',
    limit: '30',
    extratags: '1',
    addressdetails: '1',
  });
  if (!Array.isArray(results)) return [];

  const items = [];
  const seen = new Set();
  for (const r of results) {
    const name = r.name || (r.display_name || '').split(',')[0];
    if (!name) continue;
    const elLat = Number(r.lat);
    const elLon = Number(r.lon);
    if (!Number.isFinite(elLat) || !Number.isFinite(elLon)) continue;
    const distance = haversineKm(lat, lon, elLat, elLon);
    if (distance > radiusM / 1000) continue;
    const dedupe = `${name.toLowerCase()}|${elLat.toFixed(4)}|${elLon.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const tags = r.extratags || {};
    const isHospital = r.type === 'hospital' || r.class === 'hospital' || tags.amenity === 'hospital';
    const speciality = tags['healthcare:speciality'] || tags.speciality || '';
    // Nominatim matches "dermatologist" against names, but drop clearly
    // unrelated places (pharmacies, general shops) when we asked for care.
    if (!isHospital && kind !== 'clinic' && r.class && !['amenity', 'healthcare', 'building'].includes(r.class)) continue;
    if (!isHospital && r.type && !['doctors', 'clinic', 'hospital', 'yes'].includes(r.type) && !/derma|skin|clinic|hospital/i.test(name)) continue;

    items.push({
      name,
      address: r.display_name || '',
      lat: elLat,
      lon: elLon,
      distance_km: Math.round(distance * 10) / 10,
      phone: tags.phone || tags['contact:phone'] || '',
      website: tags.website || tags['contact:website'] || '',
      opening_hours: tags.opening_hours || '',
      open_now: null,
      emergency: isHospital,
      kind: isHospital ? 'hospital' : 'clinic',
      speciality,
      maps_url: mapsDirections(elLat, elLon),
      source: 'openstreetmap',
    });
  }
  return items;
}

function parseOsm(payload, lat, lon, radiusM, kind) {
  const items = [];
  const seen = new Set();
  for (const el of payload.elements || []) {
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];
    if (!name) continue;
    const center = el.center || {};
    const elLat = Number(el.lat ?? center.lat);
    const elLon = Number(el.lon ?? center.lon);
    if (!Number.isFinite(elLat) || !Number.isFinite(elLon)) continue;
    const distance = haversineKm(lat, lon, elLat, elLon);
    if (distance > radiusM / 1000) continue;
    const dedupe = `${name.toLowerCase()}|${elLat.toFixed(4)}|${elLon.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const address = [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:suburb'] || tags['addr:neighbourhood'],
      tags['addr:city'],
      tags['addr:postcode'],
    ].filter(Boolean).join(', ');

    const isHospital = tags.amenity === 'hospital' || tags.healthcare === 'hospital';
    const itemKind = isHospital ? 'hospital' : (tags.amenity === 'doctors' || tags.healthcare === 'doctor') ? 'doctor' : 'clinic';
    items.push({
      name,
      address,
      lat: elLat,
      lon: elLon,
      distance_km: Math.round(distance * 10) / 10,
      phone: tags.phone || tags['contact:phone'] || '',
      website: tags.website || tags['contact:website'] || '',
      opening_hours: tags.opening_hours || '',
      open_now: null,
      emergency: isHospital && (tags.emergency === 'yes' || tags['emergency:department'] === 'yes'),
      kind: kind === 'hospital' ? 'hospital' : itemKind,
      speciality: tags['healthcare:speciality'] || tags.speciality || '',
      maps_url: mapsDirections(elLat, elLon),
      source: 'openstreetmap',
    });
  }
  return items;
}

async function nearby({ lat, lon, city, kind = 'dermatologist', radiusKm = 10, limit = 12 }) {
  let origin = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    origin = { lat: clampLat(lat), lon: clampLon(lon) };
  } else if (city) {
    origin = await geocode(city);
    if (!origin) {
      const err = new Error(`Could not find “${city}”. Try a nearby town with the state or country.`);
      err.status = 404;
      throw err;
    }
  } else {
    const err = new Error('Provide your coordinates or a city/area name.');
    err.status = 400;
    throw err;
  }

  let radiusM = Math.round(Math.min(50, Math.max(1, radiusKm)) * 1000);
  let radiusUsedKm = Math.min(50, Math.max(1, radiusKm));
  let items = [];
  let source = 'openstreetmap';

  if (config.googlePlacesKey) {
    try {
      items = await googleNearby(origin.lat, origin.lon, radiusM, kind, limit);
      if (items.length) source = 'google';
    } catch (err) {
      console.warn('[care] Google Places failed, falling back to OSM:', err.message);
    }
  }

  if (!items.length) {
    try {
      const payload = await overpass(origin.lat, origin.lon, radiusM, kind);
      items = parseOsm(payload, origin.lat, origin.lon, radiusM, kind);
    } catch (err) {
      console.warn('[care] Overpass unavailable, trying Nominatim place search:', err.message);
    }
  }

  // Nominatim is a lighter fallback (and a second chance when Overpass found
  // nothing). If the requested radius is empty, look a little further out.
  if (!items.length) {
    const tries = [radiusM];
    if (radiusM < 25000) tries.push(25000);
    if (radiusM < 50000) tries.push(50000);
    for (const tryM of tries) {
      try {
        items = await nominatimPlaces(origin.lat, origin.lon, tryM, kind);
        if (items.length) {
          source = 'nominatim';
          radiusM = tryM;
          radiusUsedKm = Math.round(tryM / 1000);
          break;
        }
      } catch (fallbackErr) {
        console.warn('[care] Nominatim place search failed:', fallbackErr.message);
        break;
      }
    }
  }

  // Hospitals that explicitly handle emergencies first, then nearest.
  items.sort((a, b) => (Number(b.emergency) - Number(a.emergency)) || a.distance_km - b.distance_km);
  items = items.slice(0, limit);

  let place = origin.label || '';
  let countryCode = origin.country_code || '';
  if (!place || !countryCode) {
    const rev = await reverse(origin.lat, origin.lon);
    if (rev) {
      place = place || rev.label;
      countryCode = countryCode || rev.country_code;
    }
  }

  return {
    origin: { lat: origin.lat, lon: origin.lon, label: place, city: origin.city || '', country_code: countryCode },
    kind,
    radius_km: radiusUsedKm,
    count: items.length,
    items,
    source,
    maps_search_url: mapsSearch(origin.lat, origin.lon, kind),
    message: items.length
      ? ''
      : 'No matching places found in OpenStreetMap for this area. Try a larger radius, a nearby city, or open the map search.',
    emergency_numbers: emergencyNumbers(countryCode),
  };
}

// ---------- emergency contacts ----------

const EMERGENCY = {
  IN: { label: 'India', numbers: [['Emergency (all services)', '112'], ['Ambulance', '108'], ['Police', '100'], ['Fire', '101']] },
  US: { label: 'United States', numbers: [['Emergency', '911']] },
  CA: { label: 'Canada', numbers: [['Emergency', '911']] },
  GB: { label: 'United Kingdom', numbers: [['Emergency', '999'], ['Non-emergency medical', '111']] },
  AU: { label: 'Australia', numbers: [['Emergency', '000'], ['Health advice', '1800 022 222']] },
  NZ: { label: 'New Zealand', numbers: [['Emergency', '111']] },
  AE: { label: 'United Arab Emirates', numbers: [['Emergency', '999'], ['Ambulance', '998']] },
  SA: { label: 'Saudi Arabia', numbers: [['Emergency', '911'], ['Ambulance', '997']] },
  PK: { label: 'Pakistan', numbers: [['Emergency', '1122'], ['Police', '15']] },
  BD: { label: 'Bangladesh', numbers: [['Emergency', '999']] },
  LK: { label: 'Sri Lanka', numbers: [['Ambulance', '1990'], ['Police', '119']] },
  NP: { label: 'Nepal', numbers: [['Ambulance', '102'], ['Police', '100']] },
  BT: { label: 'Bhutan', numbers: [['Emergency', '112']] },
  SG: { label: 'Singapore', numbers: [['Emergency', '995']] },
  MY: { label: 'Malaysia', numbers: [['Emergency', '999']] },
  ID: { label: 'Indonesia', numbers: [['Emergency', '112']] },
  PH: { label: 'Philippines', numbers: [['Emergency', '911']] },
  ZA: { label: 'South Africa', numbers: [['Emergency', '10177']] },
  NG: { label: 'Nigeria', numbers: [['Emergency', '112']] },
  KE: { label: 'Kenya', numbers: [['Emergency', '999']] },
  DE: { label: 'Germany', numbers: [['Emergency', '112']] },
  FR: { label: 'France', numbers: [['Emergency', '112'], ['SAMU', '15']] },
  ES: { label: 'Spain', numbers: [['Emergency', '112']] },
  IT: { label: 'Italy', numbers: [['Emergency', '112']] },
  NL: { label: 'Netherlands', numbers: [['Emergency', '112']] },
  BR: { label: 'Brazil', numbers: [['SAMU ambulance', '192']] },
  MX: { label: 'Mexico', numbers: [['Emergency', '911']] },
};

function emergencyNumbers(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  const entry = EMERGENCY[code];
  if (entry) {
    return {
      country: entry.label,
      country_code: code,
      numbers: entry.numbers.map(([label, number]) => ({ label, number })),
    };
  }
  return {
    country: code || 'Unknown',
    country_code: code,
    numbers: [],
    note: 'Emergency numbers differ by country. Search “emergency number” for your location, or ask someone nearby to call local emergency services.',
  };
}

module.exports = { nearby, geocode, reverse, emergencyNumbers, nearbyCountries: Object.keys(EMERGENCY).length };
