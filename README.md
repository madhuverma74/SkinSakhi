<<<<<<< HEAD
# SkinSakhi
TAI Skin Analysis: Helps users explore possible skin concerns through skin image analysis. - Doctor, Clinic &amp; Hospital Recommendations: Helps users discover suitable healthcare providers and nearby medical facilities. - Dermatologist Appointment Booking: Allows users to book dermatologist consultations,  - Emergency Contacts:,treking 
=======
# SkinSakhi 2.0 — AI skin health companion

A complete hackathon-ready web app that takes one skin photo, screens it with
computer vision, gives practical self-care advice, detects warning signs, finds
nearby dermatologists or hospitals, and books an appointment.

Everything runs locally. **No paid API key is required.**

- Frontend + backend: Node.js + Express + SQLite (one process, one port)
- Vision: built-in local engine (`sharp`), with optional notebook
  MobileNetV2 models via a Python service
- Nearby care: OpenStreetMap / Nominatim (no key), optional Google Places
- Auth, journals, trek planner and product recommendations are integrated

---

## Quick start (Windows / macOS / Linux)

Requires **Node.js 20+**.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm start
```

Open **http://localhost:3000**.

That is enough for the full demo. `JWT_SECRET` is optional locally (a temporary
one is generated and printed as a warning); set it to keep logins across
restarts.

```bash
npm run test:smoke        # 27 end-to-end API checks (server must be running)
```

---

## What the user can do

1. **Sign up / log in** — httpOnly cookie sessions, bcrypt password hashes.
2. **Upload a skin photo** and optionally tick warning signs (non-healing sore,
   changing mole, blisters, fever + rash, swelling, breathing trouble, ...).
3. **Get a screening result**
   - 0–100 skin score and a plain-language summary
   - up to 4 detected concerns with confidence bars and notes
   - morning / evening routine
   - practical suggestions
   - urgency banner: `routine` → `soon` → `urgent` → `emergency`
4. **Find care** — dermatologist / hospital / skin clinic near a city or GPS
   location, with distance, phone, directions and **Book**.
5. **Book an appointment** — saves a request with phone and map link. A
   hospital booking is supported for urgent cases.
6. **Emergency numbers** — country-aware numbers (India 112/108, US 911, UK
   999, ...) when there is a red flag.
7. **History / journal** — past analyses (score + urgency), private photos,
   text notes.
8. **Extra features already in the app** — trek UV/weather planner, product
   recommendations by concern.

> SkinSakhi is a wellness screening tool, not a diagnosis. The result screen and
> journal always show that disclaimer.

---

## How the AI works

### Default: local vision engine (`src/services/skinEngine.js`)

The app decodes the photo with `sharp`, resizes it, and measures:

- redness / colour balance
- dark-spot and bright-spot ratios
- tone variance (pigmentation)
- fine texture, edges and line energy (pores, wrinkles)

Those measurements are mapped to the notebook's **8 everyday classes**:
Redness, Dark Spots, Inflammatory Acne, Blackheads, Whiteheads, Pigmentation,
Pores, Wrinkles. It also runs a photo-quality check (too dark, blurry, glare,
too small) and returns a friendly note instead of pretending the result is good.

The engine is honest about what it is: `engine.name` is
**"SkinSakhi Vision v1 (local)"** with `mode: "local"`.

### Optional: notebook MobileNetV2 models (`ml-service/`)

The notebook (`complete (3).ipynb`) trained two models:

- **8-class daily model** — everyday cosmetic concerns
- **22-class disease screening model** — Acne, Eczema, Psoriasis, Moles,
  SkinCancer, Vitiligo, ...

If you export the `.keras` files and run the Python service, set
`MODEL_SERVICE_URL` and the Node app switches to
**"SkinSakhi × MobileNetV2 (notebook)"** automatically. See
[`ml-service/README.md`](ml-service/README.md).

If the model service is down, the app silently falls back to the local engine —
the demo never breaks. The `.keras` files are not committed here (they live in
Google Drive and were trained in Colab), and TensorFlow needs Python 3.9–3.12,
not 3.13/3.14.

### Urgency logic (`src/services/skinData.js`)

Urgency is driven by the user's answers first, then model/visual signals:

| Level | Meaning |
|---|---|
| `emergency` | breathing trouble, face/lip/tongue swelling, fever with spreading rash → call emergency services now |
| `urgent` | bleeding/non-healing sore, changing mole, rapid growth, blisters, infection, severe pain, eye involvement → 24–48 hours |
| `soon` | strong visual concern or several moderate ones → dermatologist in 1–2 weeks |
| `routine` | no red flags → self-care and re-check |

This is deliberately conservative: a cosmetic AI result never overrides a
medical warning sign.

---

## Nearby care and emergency numbers

`GET /api/care/nearby` supports:

```text
?city=Bengaluru&kind=dermatologist|hospital|clinic&radius=10&limit=12
?lat=12.97&lon=77.59&kind=hospital
```

- Tries **Overpass** first, then **Nominatim place search** if mirrors are slow
  (public Overpass is often overloaded), and expands the radius automatically
  when the requested area is empty.
- If `GOOGLE_PLACES_API_KEY` is set, Google Places is tried first.
- Hospitals with an emergency department are sorted first.
- Every card has call, directions (Google Maps), website (if known) and book.

`GET /api/care/emergency?country=IN` or `?lat=&lon=` returns local emergency
numbers. The frontend also asks for geolocation when the user taps
“Use my location”.

Data comes from OpenStreetMap contributors and may be incomplete; the UI says
to call ahead. SkinSakhi cannot dispatch help.

---

## API overview

| Area | Endpoints |
|---|---|
| Health | `GET /api/health` |
| Accounts | `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET/PUT /api/auth/me`, `POST /api/auth/password`, `DELETE /api/auth/me` |
| Analysis | `POST /api/analysis` (multipart `image`, `language`, optional `symptoms` JSON), `GET /api/analysis`, `GET /api/analysis/latest`, `GET /api/analysis/stats`, `GET /api/analysis/:id`, `GET /api/analysis/:id/image`, `DELETE /api/analysis/:id` |
| Care | `GET /api/care/nearby`, `GET /api/care/emergency` |
| Appointments | `GET /api/appointments`, `POST /api/appointments`, `PATCH /api/appointments/:id/cancel` |
| Journal | `GET/POST /api/journal`, `PUT/DELETE /api/journal/:id` |
| Products | `GET /api/products?concern=`, `GET /api/recommendations` |
| Trek | `POST /api/trek/plan`, `GET/PUT/DELETE /api/trek/checklist`, `GET /api/trek/plans` |

Symptom keys accepted by `POST /api/analysis`:

```json
["bleeding_sore","changing_mole","rapid_growth","blisters","infection",
 "severe_pain","fever_rash","eye","face_swelling","breathing"]
```

Example with `curl`:

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"Demo User","email":"demo@example.com","password":"DemoPass123!"}' \
  http://localhost:3000/api/auth/signup

curl -b cookies.txt -F "image=@photo.jpg" \
  -F 'symptoms=["changing_mole"]' \
  http://localhost:3000/api/analysis
```

---

## Project layout

```
skinsakhi/
  server.js                 Express app, security headers, static files
  public/                   frontend (index.html, script.js, style.css, extra.css)
  src/
    db.js                   SQLite schema + forward migrations
    config.js               environment
    routes/                 auth, analysis, care, appointments, journal, trek, products
    services/
      skinEngine.js         local vision engine + notebook service bridge
      skinData.js           conditions, notebook advice, urgency rules
      care.js               Overpass / Nominatim / Google Places + emergency numbers
  ml-service/               optional FastAPI + TensorFlow .keras service
  scripts/smoke-test.mjs    27-check end-to-end test
  data/                     SQLite DB + uploaded photos (gitignored)
```

---

## Demo script (2 minutes)

1. Open http://localhost:3000 and sign up.
2. Upload a face photo; tick **“A sore that bleeds or won’t heal”**.
3. Show the score, concern bars, routine and the **urgent** banner.
4. Click **Hospitals near me** (or type `Bengaluru`) → results with distance and
   phone → **Book** → set tomorrow 10:30 → request saved.
5. Open **Find Care → Emergency numbers** and show country-aware numbers.
6. Open the notification bell / journal to show history and score chips.

To show the `emergency` level, analyse another photo with **breathing trouble**
or **face swelling** ticked.

---

## Security and privacy

- Passwords: bcrypt; session: httpOnly, SameSite cookie; password change revokes
  other sessions.
- Rate limits: login/signup, 20 analyses/hour/user, 60 care searches/hour.
- Uploads: 5 MB cap, real type sniffed from bytes, random filenames, photos only
  served to their owner.
- Parameterized SQL everywhere; all user text escaped in the UI.
- Account deletion removes analyses, photos and notes.
- Health photos are sensitive: add a real privacy policy before deploying.

Before going online: set `NODE_ENV=production`, a strong `JWT_SECRET`, HTTPS,
`TRUST_PROXY` if behind a proxy, and back up `data/`.

---

## Known limitations

- The notebook `.keras` models are not included; the local engine is the default
  demo path. See `ml-service/README.md` to plug them in.
- Appointments are **requests** saved in your account. Nothing contacts the
  clinic yet; call the number shown to confirm.
- OpenStreetMap coverage/phone numbers vary by city, and public Overpass can be
  slow (the app falls back to Nominatim or the map search).
- Interface text is English; the language preference is stored for analysis
  metadata.
- The 22-class disease model is a screening signal only and must not be
  presented as a diagnosis.
>>>>>>> 7962f68 (Done)
