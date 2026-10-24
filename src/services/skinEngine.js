const sharp = require('sharp');
const config = require('../config');
const {
  CONDITIONS,
  DAILY_CLASSES,
  DISEASE_URGENCY,
  SYMPTOMS,
  URGENCY,
  DISCLAIMER,
  keyFromModelName,
} = require('./skinData');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 0) => Number(v.toFixed(d));
const logistic = (x, mid, steep) => 1 / (1 + Math.exp(-steep * (x - mid)));
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const std = (arr, m = mean(arr)) => Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);

// ---------- image decoding and measurements ----------

function boxBlur(src, w, h, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const d = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / d;
      sum += src[row + clamp(x + radius + 1, 0, w - 1)] - src[row + clamp(x - radius, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / d;
      sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x];
    }
  }
  return out;
}

async function extractFeatures(buffer) {
  const meta = await sharp(buffer).metadata();
  const { data, info } = await sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const n = w * h;
  const c = info.channels;
  const luma = new Float32Array(n);
  const rCh = new Float32Array(n);
  const gCh = new Float32Array(n);
  const bCh = new Float32Array(n);
  const rg = new Float32Array(n);
  const yb = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * c];
    const g = data[i * c + 1];
    const b = data[i * c + 2];
    rCh[i] = r; gCh[i] = g; bCh[i] = b;
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    rg[i] = r - g;
    yb[i] = (r + g) / 2 - b;
  }

  const meanLuma = mean(luma);
  const lumaStd = std(luma, meanLuma);
  const meanR = mean(rCh);
  const meanG = mean(gCh);
  const meanB = mean(bCh);
  const rednessBase = (meanR - (meanG + meanB) / 2) / 255;

  const fine = boxBlur(luma, w, h, 2);
  const coarse = boxBlur(luma, w, h, 9);
  const coarseRg = boxBlur(rg, w, h, 9);
  const coarseYb = boxBlur(yb, w, h, 9);

  let residualSum = 0;
  let darkSpots = 0;
  let brightSpots = 0;
  let redSpots = 0;
  let highlights = 0;
  let deepShadows = 0;

  for (let i = 0; i < n; i++) {
    const residual = luma[i] - fine[i];
    residualSum += Math.abs(residual);
    if (residual < -7 && luma[i] < meanLuma * 1.08) darkSpots++;
    if (residual > 11 && luma[i] < 250) brightSpots++;
    if (rg[i] > 26 && yb[i] > 5 && luma[i] < 225) redSpots++;
    if (luma[i] > 240) highlights++;
    if (luma[i] < 38) deepShadows++;
  }

  let edgeSum = 0;
  let lineSum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + w] - luma[i - w];
      edgeSum += Math.hypot(gx, gy);
      lineSum += Math.abs(gx) > Math.abs(gy) * 2 ? Math.abs(gx) : 0;
    }
  }

  const toneVar = (std(coarseRg) + std(coarseYb)) / 2;
  const coarseVar = std(coarse);
  const texture = residualSum / n;
  const edgeEnergy = edgeSum / n;
  const lineEnergy = lineSum / n;

  const regionTexture = (y0, y1) => {
    let s = 0;
    for (let y = Math.floor(h * y0); y < Math.floor(h * y1); y++) {
      for (let x = 20; x < w - 20; x++) s += Math.abs(luma[y * w + x] - fine[y * w + x]);
    }
    return s / ((y1 - y0) * h * (w - 40));
  };

  return {
    width: meta.width || w,
    height: meta.height || h,
    meanLuma,
    lumaStd,
    rednessBase,
    toneVar,
    coarseVar,
    texture,
    edgeEnergy,
    lineEnergy,
    darkSpotRatio: darkSpots / n,
    brightSpotRatio: brightSpots / n,
    redSpotRatio: redSpots / n,
    highlightRatio: highlights / n,
    shadowRatio: deepShadows / n,
    textureTop: regionTexture(0, 0.33),
    textureMid: regionTexture(0.33, 0.66),
    textureBottom: regionTexture(0.66, 1),
  };
}

function scoreConditions(f) {
  const dark = f.darkSpotRatio * 100; // percentages make the numbers easier to reason about
  const bright = f.brightSpotRatio * 100;
  const red = f.redSpotRatio * 100;
  const base = f.rednessBase * 100;
  const tone = f.toneVar;
  const tex = f.texture;

  return {
    redness: logistic(base * 3.2 + red * 0.9, 15, 0.32),
    dark_spots: logistic(dark * 0.9 + tone * 0.35, 9, 0.28),
    inflammatory_acne: logistic(red * 1.15 + base * 0.6, 8, 0.3),
    blackheads: logistic(dark * 1.05 + tex * 0.5, 10, 0.28),
    whiteheads: logistic(bright * 1.25, 5, 0.35),
    pigmentation: logistic(tone * 0.9 + dark * 0.45, 11, 0.26),
    pores: logistic(tex * 1.2 + f.edgeEnergy * 0.9, 10, 0.3),
    wrinkles: logistic(tex * 0.8 + f.lineEnergy * 1.6, 10, 0.3),
  };
}

function qualityCheck(f) {
  const megapixels = (f.width * f.height) / 1e6;
  if (megapixels < 0.04) {
    return { ok: false, note: 'The photo is very small. Upload a larger, sharper photo for a more reliable screening.' };
  }
  if (f.meanLuma < 38) {
    return { ok: false, note: 'The photo looks too dark. Take it again in soft, even daylight without a strong shadow.' };
  }
  if (f.meanLuma > 246) {
    return { ok: false, note: 'The photo is overexposed. Avoid direct flash or strong sunlight on the skin.' };
  }
  if (f.lumaStd < 7) {
    return { ok: false, note: 'The photo has very little visible detail. Move closer and keep the camera steady.' };
  }
  if (f.texture < 0.7) {
    return { ok: false, note: 'The photo may be blurry. Hold the camera steady and let it focus on your skin.' };
  }
  if (f.highlightRatio > 0.16) {
    return { ok: true, note: 'There is a lot of glare in the photo. Results may be less accurate; diffuse daylight works better.' };
  }
  return { ok: true, note: '' };
}

// ---------- optional notebook model service ----------

async function predictWithNotebookModel(buffer, mime) {
  if (!config.modelServiceUrl) return null;
  try {
    const form = new FormData();
    form.append('image', new Blob([buffer], { type: mime }), 'skin.jpg');
    const res = await fetch(config.modelServiceUrl.replace(/\/$/, '') + '/predict', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('model service returned ' + res.status);
    const data = await res.json();
    const daily = (Array.isArray(data.daily) ? data.daily : [])
      .map((d) => ({ key: keyFromModelName(d.name), name: d.name, confidence: Number(d.confidence) }))
      .filter((d) => d.key && Number.isFinite(d.confidence))
      .map((d) => ({ ...d, confidence: clamp(d.confidence, 0, 100) }));
    if (!daily.length) throw new Error('model service returned no usable classes');
    const disease = (Array.isArray(data.disease) ? data.disease : [])
      .map((d) => ({ name: String(d.name || ''), confidence: clamp(Number(d.confidence) || 0, 0, 100) }))
      .filter((d) => d.name && d.confidence > 0)
      .slice(0, 3);
    return { daily, disease, model: String(data.model || 'notebook-mobilenetv2') };
  } catch (err) {
    console.warn('[skin] model service unavailable, using local vision engine:', err.message);
    return null;
  }
}

// ---------- synthesis ----------

const severityFor = (confidence) => (confidence >= 70 ? 'high' : confidence >= 50 ? 'medium' : 'low');

function buildConditions(scores) {
  const entries = Object.entries(scores)
    .map(([key, score]) => ({ key, score, meta: CONDITIONS[key] }))
    .sort((a, b) => b.score - a.score);
  const top = entries[0];
  const second = entries[1] || { score: 0 };
  if (!top || top.score < 0.24) return [];

  const margin = clamp(top.score - second.score, 0, 1);
  const topConfidence = Math.round(clamp(45 + top.score * 46 + margin * 18, 45, 97));

  return entries
    .filter((e, i) => i === 0 || (e.score / top.score >= 0.58 && topConfidence * (e.score / top.score) >= 33))
    .slice(0, 4)
    .map((e, i) => {
      const confidence = i === 0 ? topConfidence : Math.round(topConfidence * (e.score / top.score) * 0.86);
      return {
        key: e.key,
        name: e.meta.name,
        category: e.meta.category,
        productConcern: e.meta.productConcern,
        confidence,
        severity: severityFor(confidence),
        note: e.meta.note,
        advice: e.meta.advice,
      };
    });
}

const unique = (items, max) => [...new Set(items.filter(Boolean))].slice(0, max);

function buildPlan(conditions) {
  const morning = [];
  const evening = [];
  const advice = [];
  for (const c of conditions) {
    const meta = CONDITIONS[c.key];
    morning.push(...meta.morning);
    evening.push(...meta.evening);
    advice.push(...meta.advice);
  }
  if (!conditions.length) {
    morning.push('Gentle cleanser', 'Moisturizer', 'Sunscreen SPF 30+');
    evening.push('Gentle cleanser', 'Moisturizer');
    advice.push('Keep a simple routine and use sunscreen every morning.', 'Re-check your skin in 2–4 weeks.');
  }
  if (!morning.some((s) => /sunscreen/i.test(s))) morning.push('Sunscreen SPF 30+');
  if (!morning.some((s) => /cleanser/i.test(s))) morning.unshift('Gentle cleanser');
  if (!evening.some((s) => /cleanser/i.test(s))) evening.unshift('Gentle cleanser');
  if (!evening.some((s) => /moistur/i.test(s))) evening.push('Moisturizer');
  return {
    morning: unique(morning, 6),
    evening: unique(evening, 6),
    advice: unique(advice, 8),
  };
}

function buildUrgency(conditions, symptoms, disease) {
  const flagged = Object.keys(symptoms)
    .filter((k) => symptoms[k] && SYMPTOMS[k])
    .map((k) => ({ key: k, label: SYMPTOMS[k].label, level: SYMPTOMS[k].level }));
  const emergency = flagged.filter((s) => s.level === 'emergency');
  const urgent = flagged.filter((s) => s.level === 'urgent');

  let level = 'routine';
  let reason = '';
  if (emergency.length) {
    level = 'emergency';
    reason = emergency.map((s) => s.label).join('; ');
  } else if (urgent.length) {
    level = 'urgent';
    reason = urgent.map((s) => s.label).join('; ');
  } else if (disease && DISEASE_URGENCY[disease.name] && disease.confidence >= 35) {
    const d = DISEASE_URGENCY[disease.name];
    level = d.level;
    reason = `${d.reason} (pattern: ${disease.name.replace(/_/g, ' ')}, ${Math.round(disease.confidence)}% model confidence)`;
  } else if (conditions.some((c) => c.severity === 'high')) {
    level = 'soon';
    reason = 'A strong skin concern was detected in the photo.';
  } else if (conditions.filter((c) => c.severity === 'medium').length >= 2) {
    level = 'soon';
    reason = 'Several moderate skin concerns were detected.';
  }

  return {
    level,
    ...URGENCY[level],
    reason,
    red_flags: flagged.map((f) => f.label),
    window: level === 'emergency' ? 'now' : level === 'urgent' ? '24–48 hours' : level === 'soon' ? '1–2 weeks' : null,
  };
}

function scoreSkin(conditions, symptoms) {
  let score = 96;
  for (const c of conditions) {
    const weight = c.severity === 'high' ? 19 : c.severity === 'medium' ? 11 : 5;
    score -= weight * (0.55 + c.confidence / 160);
  }
  const urgentCount = Object.keys(symptoms).filter((k) => symptoms[k]).length;
  score -= Math.min(14, urgentCount * 4);
  return Math.round(clamp(score, 25, 97));
}

function buildSummary(conditions, quality, urgency, usingModel) {
  const source = usingModel
    ? 'The notebook MobileNetV2 model and SkinSakhi vision checks looked at this photo.'
    : 'SkinSakhi’s local vision engine analysed colour, texture and contrast in this photo.';
  if (!conditions.length) {
    return `${source} No strong cosmetic concern stood out. Keep protecting your skin from the sun and re-check in a few weeks.`;
  }
  const list = conditions.map((c) => `${c.name} (${c.confidence}%)`).join(', ');
  const qualityNote = quality.ok ? '' : ' Photo quality limited the screening.';
  const urgentNote = urgency.level === 'emergency' || urgency.level === 'urgent'
    ? ' Because of the warning signs you selected, please act on the medical guidance below.'
    : '';
  return `${source} The strongest signals were ${list}. These are cosmetic observations, not a diagnosis.${qualityNote}${urgentNote}`;
}

async function analyzeSkinImage({ buffer, mime, symptoms = {} }) {
  const features = await extractFeatures(buffer);
  const quality = qualityCheck(features);
  const model = await predictWithNotebookModel(buffer, mime);

  const localConditions = buildConditions(scoreConditions(features));
  const conditions = model
    ? model.daily
        .slice()
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4)
        .map((d) => {
          const meta = CONDITIONS[d.key];
          return {
            key: d.key,
            name: meta.name,
            category: meta.category,
            productConcern: meta.productConcern,
            confidence: Math.round(d.confidence),
            severity: severityFor(d.confidence),
            note: meta.note,
            advice: meta.advice,
          };
        })
    : localConditions;

  const plan = buildPlan(conditions);
  const disease = model && model.disease.length ? model.disease[0] : null;
  const urgency = buildUrgency(conditions, symptoms, disease);
  const score = scoreSkin(conditions, symptoms);
  const seeDoctor = urgency.level !== 'routine' || conditions.some((c) => c.severity === 'high');

  const care = {
    recommended: urgency.level !== 'routine',
    kind: urgency.level === 'emergency' ? 'hospital' : 'dermatologist',
    window: urgency.window,
    note: urgency.level === 'emergency'
      ? 'Go to the nearest emergency department or call your local emergency number. Use the care finder to locate hospitals with an emergency department.'
      : urgency.level === 'urgent'
        ? 'Contact a dermatologist or hospital within 24–48 hours. If you cannot reach one, use the care finder to call the nearest hospital.'
        : urgency.level === 'soon'
          ? 'Book a dermatology appointment in the next 1–2 weeks and bring this report with you.'
          : 'A dermatologist visit is optional unless your skin changes or starts to hurt.',
  };

  const result = {
    engine: {
      name: model ? 'SkinSakhi × MobileNetV2 (notebook)' : 'SkinSakhi Vision v1 (local)',
      mode: model ? 'notebook-model' : 'local',
      model_available: !!model,
      daily_classes: DAILY_CLASSES,
      note: model
        ? 'Predictions come from the notebook-trained MobileNetV2 service.'
        : 'Running on-device image analysis. Set MODEL_SERVICE_URL to use the notebook .keras models.',
    },
    image_quality_ok: quality.ok,
    image_quality_note: quality.note,
    skin_type: conditions.some((c) => c.key === 'pores' || c.key === 'blackheads') ? 'oily / combination (estimated)' : 'normal to dry (estimated)',
    score,
    score_label: score >= 80 ? 'Good' : score >= 65 ? 'Fair' : score >= 50 ? 'Needs attention' : 'See a professional',
    summary: buildSummary(conditions, quality, urgency, !!model),
    conditions,
    concerns: conditions.map((c) => ({
      name: c.name,
      category: c.category,
      severity: c.severity,
      confidence: c.confidence,
      note: c.note,
    })),
    routine: { morning: plan.morning, evening: plan.evening },
    suggestions: plan.advice,
    urgency,
    care,
    screening: model
      ? {
          available: true,
          model: model.model,
          top: model.disease,
          note: 'Disease-class predictions come from the notebook model. They are screening signals, not a diagnosis.',
        }
      : {
          available: false,
          model: null,
          top: [],
          note: 'The notebook disease model is not connected. Serious-symptom screening below still works: report red flags and SkinSakhi will direct you to urgent care.',
        },
    see_doctor: seeDoctor,
    see_doctor_reason: seeDoctor ? urgency.reason || urgency.message : '',
    language: 'en',
    disclaimer: DISCLAIMER,
    analyzed_at: new Date().toISOString(),
  };

  return { result, demo: false };
}

module.exports = {
  analyzeSkinImage,
  extractFeatures,
  scoreConditions,
  qualityCheck,
};
