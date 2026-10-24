// Skin knowledge base shared by the local vision engine and the AI model service.
// Condition names and advice are ported from the project notebook
// ("complete (3).ipynb", recommendations cell) so the app and the model agree.

const CONDITIONS = {
  redness: {
    name: 'Redness',
    category: 'sensitivity',
    productConcern: 'sensitivity',
    note: 'Visible flushing or red patches. Sun, heat, harsh products and irritation can all contribute.',
    advice: [
      'Use gentle, fragrance-free skincare products.',
      'Avoid harsh scrubs, hot water and over-washing.',
      'Keep skin moisturized to support the barrier.',
    ],
    morning: ['Gentle cleanser', 'Soothing moisturizer', 'Mineral sunscreen SPF 30+'],
    evening: ['Gentle cleanser', 'Barrier moisturizer'],
  },
  dark_spots: {
    name: 'Dark Spots',
    category: 'pigmentation',
    productConcern: 'pigmentation',
    note: 'Small areas of darker skin, often left behind by sun exposure or past breakouts.',
    advice: [
      'Wear SPF 30+ sunscreen every day, even when cloudy.',
      'Consider a Vitamin C serum in the morning.',
      'Avoid excessive sun exposure and reapply sunscreen outdoors.',
    ],
    morning: ['Gentle cleanser', 'Vitamin C serum', 'Moisturizer', 'Sunscreen SPF 50'],
    evening: ['Gentle cleanser', 'Niacinamide serum', 'Moisturizer'],
  },
  inflammatory_acne: {
    name: 'Inflammatory Acne',
    category: 'acne',
    productConcern: 'acne',
    note: 'Red, tender bumps or pimples caused by inflamed pores.',
    advice: [
      'Maintain a gentle cleansing routine twice a day.',
      'Avoid touching, picking or squeezing pimples.',
      'See a dermatologist if it is painful, widespread or leaving marks.',
    ],
    morning: ['Gentle cleanser', 'Oil-free moisturizer', 'Sunscreen SPF 30+'],
    evening: ['Gentle cleanser', 'Benzoyl peroxide spot treatment', 'Oil-free moisturizer'],
  },
  blackheads: {
    name: 'Blackheads',
    category: 'acne',
    productConcern: 'acne',
    note: 'Open pores with dark plugs of oil and dead skin, common on the nose and chin.',
    advice: [
      'Use non-comedogenic (won’t clog pores) products.',
      'Keep pores clean with gentle cleansing.',
      'Consider salicylic acid (BHA) products a few times a week.',
    ],
    morning: ['Gentle cleanser', 'Lightweight moisturizer', 'Sunscreen SPF 30+'],
    evening: ['Gentle cleanser', 'Salicylic acid (BHA) treatment', 'Lightweight moisturizer'],
  },
  whiteheads: {
    name: 'Whiteheads',
    category: 'acne',
    productConcern: 'acne',
    note: 'Closed pores with small white bumps under the skin surface.',
    advice: [
      'Use a gentle cleanser and avoid heavy, oily products.',
      'Keep a simple, consistent skincare routine.',
      'Do not squeeze whiteheads; it can cause marks and infection.',
    ],
    morning: ['Gentle cleanser', 'Oil-free moisturizer', 'Sunscreen SPF 30+'],
    evening: ['Gentle cleanser', 'Salicylic acid (BHA) treatment', 'Oil-free moisturizer'],
  },
  pigmentation: {
    name: 'Pigmentation',
    category: 'pigmentation',
    productConcern: 'pigmentation',
    note: 'Broad unevenness in skin tone rather than a single spot.',
    advice: [
      'Use sunscreen regularly; it is the most important step for uneven tone.',
      'Consider niacinamide or Vitamin C products.',
      'Consult a dermatologist for persistent or spreading pigmentation.',
    ],
    morning: ['Gentle cleanser', 'Niacinamide or Vitamin C serum', 'Moisturizer', 'Sunscreen SPF 50'],
    evening: ['Gentle cleanser', 'Moisturizer'],
  },
  pores: {
    name: 'Pores',
    category: 'oiliness',
    productConcern: 'oiliness',
    note: 'Visible or enlarged pores, often linked to oiliness and skin texture.',
    advice: [
      'Use sunscreen daily to protect skin texture.',
      'Keep skin hydrated; dehydrated skin can look more textured.',
      'Choose suitable, non-comedogenic skincare products.',
    ],
    morning: ['Gentle cleanser', 'Niacinamide serum', 'Gel moisturizer', 'Sunscreen SPF 30+'],
    evening: ['Gentle cleanser', 'Niacinamide serum', 'Gel moisturizer'],
  },
  wrinkles: {
    name: 'Wrinkles',
    category: 'aging',
    productConcern: 'aging',
    note: 'Fine lines or creases, usually from sun exposure, expression and age.',
    advice: [
      'Use sunscreen regularly; it prevents most visible skin ageing.',
      'Keep skin well moisturized.',
      'Consider anti-ageing ingredients such as retinoids (start low, night only).',
    ],
    morning: ['Gentle cleanser', 'Peptide moisturizer', 'Sunscreen SPF 50'],
    evening: ['Gentle cleanser', 'Retinoid 2 nights a week', 'Peptide moisturizer'],
  },
};

// The 8 classes the notebook's daily skin model was trained on.
const DAILY_CLASSES = [
  'Redness',
  'Dark Spots',
  'Inflammatory Acne',
  'Non Inflammatory Acne Blackheads',
  'Non Inflammatory Acne Whiteheads',
  'Pigmentation',
  'Pores',
  'Wrinkles',
];

const MODEL_TO_KEY = {
  redness: 'redness',
  'dark spots': 'dark_spots',
  'inflammatory acne': 'inflammatory_acne',
  'non inflammatory acne blackheads': 'blackheads',
  'non inflammatory acne white heads': 'whiteheads',
  'non inflammatory acne whiteheads': 'whiteheads',
  pigmentation: 'pigmentation',
  pores: 'pores',
  wrinkles: 'wrinkles',
};

const keyFromModelName = (name) => {
  const n = String(name || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return MODEL_TO_KEY[n] || null;
};

// The 22 disease classes from the notebook. Used only to classify the output of
// the optional MobileNetV2 model service; the app never diagnoses on its own.
const DISEASE_CLASSES = [
  'Acne', 'Actinic_Keratosis', 'Benign_tumors', 'Bullous', 'Candidiasis', 'DrugEruption',
  'Eczema', 'Infestations_Bites', 'Lichen', 'Lupus', 'Moles', 'Psoriasis', 'Rosacea',
  'Seborr_Keratoses', 'SkinCancer', 'Sun_Sunlight_Damage', 'Tinea', 'Unknown_Normal',
  'Vascular_Tumors', 'Vasculitis', 'Vitiligo', 'Warts',
];

// Conditions that should always be checked by a doctor reasonably soon.
const DISEASE_URGENCY = {
  SkinCancer: { level: 'urgent', window: '24-48 hours', reason: 'The model flagged a pattern that needs a dermatologist’s assessment quickly.' },
  Actinic_Keratosis: { level: 'urgent', window: '1-2 weeks', reason: 'A sun-damage pattern was flagged; a dermatologist should check it.' },
  Bullous: { level: 'urgent', window: '24 hours', reason: 'Blistering skin conditions need prompt medical review.' },
  DrugEruption: { level: 'urgent', window: '24 hours', reason: 'A medicine-related rash should be reviewed promptly.' },
  Lupus: { level: 'soon', window: '1-2 weeks', reason: 'A pattern that can be associated with lupus was flagged.' },
  Vasculitis: { level: 'urgent', window: '24-48 hours', reason: 'A vascular pattern was flagged and should be checked.' },
  Vascular_Tumors: { level: 'soon', window: '1-2 weeks', reason: 'A vascular lesion pattern was flagged.' },
  SkinCancer_Other: { level: 'urgent', window: '24-48 hours', reason: 'A concerning lesion pattern was flagged.' },
  Moles: { level: 'soon', window: '2-4 weeks', reason: 'A mole was flagged; monitor it and have it checked.' },
};

const SYMPTOMS = {
  breathing: { label: 'Trouble breathing, throat tightness or dizziness', level: 'emergency' },
  face_swelling: { label: 'Swelling of the face, lips or tongue', level: 'emergency' },
  fever_rash: { label: 'Fever with a fast-spreading rash', level: 'emergency' },
  blisters: { label: 'Painful blisters or peeling skin', level: 'urgent' },
  bleeding_sore: { label: 'A sore that bleeds or will not heal', level: 'urgent' },
  changing_mole: { label: 'A mole changing size, shape or colour', level: 'urgent' },
  rapid_growth: { label: 'A lump or spot growing quickly', level: 'urgent' },
  infection: { label: 'Pus, warmth or spreading redness', level: 'urgent' },
  severe_pain: { label: 'Severe or worsening pain', level: 'urgent' },
  eye: { label: 'Eye involvement or vision changes', level: 'urgent' },
};

const URGENCY = {
  emergency: {
    title: 'Emergency care recommended',
    message: 'Your answers include warning signs that need emergency medical help now. Do not wait for an online result.',
    action: 'Call your local emergency number or go to the nearest emergency department.',
  },
  urgent: {
    title: 'See a doctor soon',
    message: 'Some signs should be checked by a doctor or dermatologist within 24–48 hours.',
    action: 'Call the nearest dermatology clinic or hospital and book the earliest slot.',
  },
  soon: {
    title: 'Book a dermatologist',
    message: 'Your skin shows concerns that a dermatologist should assess. This is not an emergency, but do not delay for weeks.',
    action: 'Book a dermatology appointment in the next 1–2 weeks.',
  },
  routine: {
    title: 'Routine self-care',
    message: 'No red-flag signs were reported. A consistent routine and sun protection are the priority.',
    action: 'Follow the plan below and re-check your skin in 2–4 weeks.',
  },
};

const DISCLAIMER =
  'This is an informational AI skin-wellness screening based on one photo and your answers. ' +
  'It is not a medical diagnosis. Lighting, camera quality, makeup and skin tone can affect results. ' +
  'For anything painful, changing, bleeding or worrying, see a qualified doctor or dermatologist.';

module.exports = {
  CONDITIONS,
  DAILY_CLASSES,
  DISEASE_CLASSES,
  DISEASE_URGENCY,
  SYMPTOMS,
  URGENCY,
  DISCLAIMER,
  keyFromModelName,
};
