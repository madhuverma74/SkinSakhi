const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'skinsakhi.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_file TEXT NOT NULL,
  image_mime TEXT NOT NULL,
  result_json TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id, id DESC);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_id INTEGER REFERENCES analyses(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  mood TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal(user_id, id DESC);

CREATE TABLE IF NOT EXISTS trek_checklist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item)
);

CREATE TABLE IF NOT EXISTS trek_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT,
  appt_date TEXT NOT NULL,
  appt_time TEXT NOT NULL,
  address TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_appts_user ON appointments(user_id, appt_date, appt_time);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concern TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  key_ingredients TEXT NOT NULL,
  usage_tip TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_concern ON products(concern);
`);

// Small forward-only migrations for databases created by an earlier version.
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('appointments', 'phone', 'TEXT');
addColumn('appointments', 'care_type', 'TEXT');
addColumn('appointments', 'maps_url', 'TEXT');

// Generic product *types* (no brands) so we never endorse a specific seller.
if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const rows = [
    ['general', 'Gentle cleanser', 'Cleanser', 'Glycerin, mild surfactants', 'Use morning and night with lukewarm water.'],
    ['general', 'Daily moisturizer', 'Moisturizer', 'Glycerin, ceramides', 'Apply to slightly damp skin after cleansing.'],
    ['general', 'Broad-spectrum sunscreen SPF 30+', 'Sunscreen', 'Zinc oxide or modern UV filters', 'Apply every morning; reapply every 2 hours outdoors.'],

    ['dryness', 'Ceramide barrier cream', 'Moisturizer', 'Ceramides, cholesterol, fatty acids', 'Use twice daily and after washing hands or face.'],
    ['dryness', 'Hyaluronic acid serum', 'Serum', 'Hyaluronic acid, glycerin', 'Apply on damp skin, then seal with a moisturizer.'],
    ['dryness', 'Creamy non-foaming cleanser', 'Cleanser', 'Glycerin, mild cleansing agents', 'Avoid hot water and harsh scrubs.'],

    ['acne', 'Salicylic acid (BHA) cleanser or leave-on', 'Treatment', 'Salicylic acid 0.5-2%', 'Start every other day to avoid over-drying.'],
    ['acne', 'Benzoyl peroxide spot treatment', 'Spot treatment', 'Benzoyl peroxide 2.5-5%', 'Dab on spots only; it can bleach fabric.'],
    ['acne', 'Oil-free gel moisturizer', 'Moisturizer', 'Glycerin, niacinamide', 'Look for "non-comedogenic" on the label.'],

    ['oiliness', 'Niacinamide serum', 'Serum', 'Niacinamide 2-5%', 'Use once or twice daily under moisturizer.'],
    ['oiliness', 'Gentle foaming cleanser', 'Cleanser', 'Mild surfactants', 'Cleanse twice daily; over-washing can increase oil.'],
    ['oiliness', 'Lightweight gel sunscreen', 'Sunscreen', 'Modern UV filters', 'Choose matte or gel textures if you feel greasy.'],

    ['pigmentation', 'Vitamin C serum', 'Serum', 'L-ascorbic acid or stable derivatives', 'Use in the morning, under sunscreen.'],
    ['pigmentation', 'Niacinamide serum', 'Serum', 'Niacinamide 4-5%', 'Helps with uneven tone over weeks to months.'],
    ['pigmentation', 'Broad-spectrum sunscreen SPF 50', 'Sunscreen', 'Zinc oxide or modern UV filters', 'Daily sunscreen is the most important step for dark spots.'],

    ['sensitivity', 'Fragrance-free soothing moisturizer', 'Moisturizer', 'Panthenol, centella, ceramides', 'Patch-test new products behind the ear first.'],
    ['sensitivity', 'Mineral sunscreen', 'Sunscreen', 'Zinc oxide, titanium dioxide', 'Often better tolerated than chemical filters.'],
    ['sensitivity', 'Gentle non-foaming cleanser', 'Cleanser', 'Glycerin, no fragrance', 'Introduce only one new product at a time.'],

    ['sun-protection', 'Broad-spectrum sunscreen SPF 30-50', 'Sunscreen', 'Zinc oxide or modern UV filters', 'Use about a teaspoon for the face and neck.'],
    ['sun-protection', 'SPF lip balm', 'Lip care', 'UV filters, emollients', 'Reapply often while outdoors.'],
    ['sun-protection', 'After-sun soothing gel', 'Soothing', 'Aloe, panthenol', 'For mild redness after sun; see a doctor for blistering burns.'],

    ['aging', 'Retinoid (start low)', 'Treatment', 'Retinol or adapalene', 'Night only, 2 nights a week to start; avoid in pregnancy.'],
    ['aging', 'Peptide moisturizer', 'Moisturizer', 'Peptides, glycerin', 'Use morning and night.'],
    ['aging', 'Broad-spectrum sunscreen SPF 30+', 'Sunscreen', 'Zinc oxide or modern UV filters', 'Sun protection prevents most visible skin aging.'],
  ];
  const ins = db.prepare('INSERT INTO products(concern,name,category,key_ingredients,usage_tip) VALUES (?,?,?,?,?)');
  db.transaction(() => rows.forEach((r) => ins.run(...r)))();
}

module.exports = db;
