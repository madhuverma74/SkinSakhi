const config = require('../config');
const { httpError, LANG_NAMES } = require('../utils');

const CATEGORIES = ['dryness', 'acne', 'oiliness', 'pigmentation', 'sensitivity', 'sun-protection', 'aging', 'general'];
const SEVERITIES = ['low', 'medium', 'high'];

const DISCLAIMER =
  'This is an informational AI wellness insight based on a single photo. It is not a medical diagnosis. ' +
  'If you are worried about your skin, please see a qualified doctor or dermatologist.';

// Detect the real image type from the first bytes instead of trusting the upload's claimed type.
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : []).map((x) => clip(x, maxLen)).filter(Boolean).slice(0, maxItems);

function categoryFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/dry|dehydrat|flak/.test(t)) return 'dryness';
  if (/acne|pimple|breakout|comedo|blemish/.test(t)) return 'acne';
  if (/oil|sebum|shine|greas/.test(t)) return 'oiliness';
  if (/pigment|dark spot|melasma|uneven|tan\b|discolou?r/.test(t)) return 'pigmentation';
  if (/sensitiv|redness|irritat|rosacea|inflam/.test(t)) return 'sensitivity';
  if (/sun|uv|photo/.test(t)) return 'sun-protection';
  if (/wrinkle|fine line|aging|ageing/.test(t)) return 'aging';
  return 'general';
}

// Whatever the model returns, force it into a safe, predictable shape.
function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const concerns = (Array.isArray(r.concerns) ? r.concerns : [])
    .slice(0, 6)
    .map((c) => {
      const name = clip(c && c.name, 80);
      if (!name) return null;
      return {
        name,
        category: CATEGORIES.includes(c.category) ? c.category : categoryFromText(name),
        severity: SEVERITIES.includes(c.severity) ? c.severity : 'low',
        note: clip(c.note, 300),
      };
    })
    .filter(Boolean);
  const routine = r.routine && typeof r.routine === 'object' ? r.routine : {};
  return {
    image_quality_ok: r.image_quality_ok !== false,
    image_quality_note: clip(r.image_quality_note, 300),
    skin_type: clip(r.skin_type, 40),
    summary: clip(r.summary, 600),
    concerns,
    routine: {
      morning: list(routine.morning, 6, 160),
      evening: list(routine.evening, 6, 160),
    },
    suggestions: list(r.suggestions, 8, 200),
    see_doctor: r.see_doctor === true,
    see_doctor_reason: clip(r.see_doctor_reason, 400),
    disclaimer: DISCLAIMER,
  };
}

const SYSTEM_PROMPT =
  'You are SkinSakhi, a friendly skin-wellness assistant. From a photo you give cosmetic and general ' +
  'skin-care observations only. You are not a doctor and you never diagnose diseases. Be honest about ' +
  'uncertainty: one photo, lighting and filters limit what can be seen. If anything looks potentially ' +
  'serious (a mole that looks irregular or changing, a sore that bleeds or does not heal, a fast-growing ' +
  'lesion, signs of infection, severe or widespread inflammation), set see_doctor to true and explain ' +
  'gently without alarming the person. If the image is not a clear photo of human skin, set ' +
  'image_quality_ok to false, say why in image_quality_note, and leave the other fields empty.';

function buildPrompt(language) {
  return (
    `Analyze this skin photo. Write every text value in ${LANG_NAMES[language] || 'English'}.\n` +
    'Respond with ONLY a JSON object (no markdown, no commentary) in exactly this shape:\n' +
    '{\n' +
    '  "image_quality_ok": true,\n' +
    '  "image_quality_note": "",\n' +
    '  "skin_type": "dry | oily | combination | normal | sensitive (best guess)",\n' +
    '  "summary": "2-3 friendly sentences",\n' +
    '  "concerns": [{"name": "", "category": "' + CATEGORIES.join(' | ') + '", "severity": "low | medium | high", "note": ""}],\n' +
    '  "routine": {"morning": ["short steps"], "evening": ["short steps"]},\n' +
    '  "suggestions": ["practical lifestyle and care tips"],\n' +
    '  "see_doctor": false,\n' +
    '  "see_doctor_reason": ""\n' +
    '}\n' +
    'Keep "category" and "severity" values in English exactly as listed. List at most 4 concerns. ' +
    'If the skin looks healthy, return an empty concerns array and say so in the summary.'
  );
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON found');
  return JSON.parse(text.slice(start, end + 1));
}

function demoResult() {
  return {
    ...normalize({
      skin_type: 'normal',
      summary: 'This is a sample result. No AI key is configured on the server, so your photo was not analyzed.',
      concerns: [
        { name: 'Mild dryness (sample)', category: 'dryness', severity: 'low', note: 'Sample data only.' },
      ],
      routine: {
        morning: ['Gentle cleanser', 'Moisturizer', 'Sunscreen SPF 30+'],
        evening: ['Gentle cleanser', 'Moisturizer'],
      },
      suggestions: ['Drink enough water', 'Use gentle skincare', 'Protect skin from the sun'],
    }),
  };
}

async function analyzeSkinImage({ buffer, mime, language }) {
  if (!config.anthropicKey) return { result: demoResult(), demo: true };

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
              { type: 'text', text: buildPrompt(language) },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    console.error('[ai] request failed:', err.message);
    throw httpError(502, 'The AI service could not be reached. Please try again in a moment.');
  }

  if (!res.ok) {
    console.error('[ai] API error', res.status, (await res.text()).slice(0, 300));
    throw httpError(502, 'The AI service is unavailable right now. Please try again later.');
  }

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { result: normalize(extractJson(text)), demo: false };
  } catch (err) {
    console.error('[ai] could not parse model output:', err.message);
    throw httpError(502, 'The AI returned an unreadable answer. Please try again.');
  }
}

module.exports = { analyzeSkinImage, sniffImage, categoryFromText, CATEGORIES };
