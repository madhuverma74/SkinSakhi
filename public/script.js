const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ymd = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString([], { dateStyle: 'medium' });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

let lastAnalysis = null;
let careKind = 'dermatologist';
let careItems = [];
let careOrigin = null;
let careCountry = '';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, form } = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, init);
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((data && data.error) || 'Something went wrong.', res.status);
  return data;
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer); // so a second toast is not hidden early by the first one's timer
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

let me = null;

function requireLogin() {
  if (me) return true;
  showToast('Please log in first.');
  setTimeout(() => { window.location.href = 'login.html'; }, 1000);
  return false;
}

function renderUser() {
  const area = $('.user-area');
  if (!area) return;
  const nameEl = $('strong', area);
  const avatar = $('.user-avatar', area);
  nameEl.textContent = me ? me.name.split(' ')[0] : 'Guest';
  avatar.textContent = me ? me.name.trim().charAt(0).toUpperCase() : 'G';

  $('#authBtn')?.remove();
  const btn = document.createElement(me ? 'button' : 'a');
  btn.id = 'authBtn';
  btn.className = 'm-btn m-outline m-small';
  if (me) {
    btn.type = 'button';
    btn.textContent = 'Logout';
    btn.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
      window.location.reload();
    });
  } else {
    btn.href = 'login.html';
    btn.textContent = 'Login';
  }
  area.appendChild(btn);

  const bell = $('.notification');
  if (bell) {
    bell.setAttribute('aria-label', 'My appointments');
    bell.onclick = () => openAppointments('doctor');
  }
}


const LANG_LABEL = { en: 'English', hi: 'Hindi', pa: 'Punjabi' };
const languageSelect = document.getElementById('languageSelect');

function currentLanguage() {
  return languageSelect.value || 'en';
}

languageSelect.addEventListener('change', async function () {
  localStorage.setItem('ss_lang', this.value);
  showToast(`${LANG_LABEL[this.value]} selected. New analyses will be written in ${LANG_LABEL[this.value]}.`);
  if (me) {
    try { await api('/auth/me', { method: 'PUT', body: { language: this.value } }); } catch { /* not critical */ }
  }
});

const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');

imageInput.addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;

  if (!IMAGE_TYPES.includes(file.type)) {
    this.value = '';
    return showToast('Please choose a JPG, PNG, WebP or GIF image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    this.value = '';
    return showToast('That image is larger than 5 MB. Please choose a smaller one.');
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    imagePreview.innerHTML = `<img src="${event.target.result}" alt="Uploaded skin image">`;
  };
  reader.readAsDataURL(file);
});

function listBlock(title, items) {
  if (!items || !items.length) return '';
  return `<div class="ar-block"><b>${esc(title)}</b><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}

function routineHtml(r) {
  const m = r.routine || {};
  if (!(m.morning || []).length && !(m.evening || []).length) return '';
  return `<div class="ar-cols">${listBlock('Morning', m.morning)}${listBlock('Evening', m.evening)}</div>`;
}

const SEVERITY_LABEL = { low: 'Mild', medium: 'Moderate', high: 'Significant' };
const URG_CLASS = { emergency: 'urg-emergency', urgent: 'urg-urgent', soon: 'urg-soon', routine: 'urg-routine' };

function scoreClass(score) {
  if (!Number.isFinite(score)) return '';
  return score >= 80 ? 'good' : score >= 65 ? 'fair' : 'low';
}

function analysisHtml(a) {
  const r = a.result || {};
  const conditions = r.conditions || [];
  const score = Number.isFinite(r.score) ? r.score : null;
  const u = r.urgency || { level: 'routine' };
  const top = conditions[0];
  return `
    <div class="ar">
      ${a.demo ? '<div class="ar-demo">DEMO RESULT: sample data, your photo was not analyzed.</div>' : ''}
      ${r.image_quality_ok === false ? `<div class="ar-warn">${esc(r.image_quality_note || 'The photo may not be clear enough for a reliable result. Try a well-lit, close-up photo.')}</div>` : ''}

      <div class="ar-top">
        <div class="score-ring ${scoreClass(score)}" style="--score:${score ?? 0}">
          <div><b>${score ?? '–'}</b><span>/ 100</span></div>
        </div>
        <div>
          <h3>${esc(r.score_label || 'Skin screening')}</h3>
          <p>${r.engine ? esc(r.engine.name) : 'AI-powered screening'}${r.skin_type ? ' · ' + esc(r.skin_type) : ''}</p>
        </div>
      </div>

      <div class="urg ${URG_CLASS[u.level] || 'urg-routine'}">
        <b>${esc(u.title || 'Screening result')}</b>
        <p>${esc(u.message || '')}</p>
        ${u.red_flags && u.red_flags.length ? `<ul>${u.red_flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      </div>

      ${r.summary ? `<p class="ar-sum">${esc(r.summary)}</p>` : ''}

      <h4 style="margin:10px 0 6px">Detected concerns</h4>
      ${conditions.length
        ? conditions.map((c) => `
          <div class="cond">
            <div class="cond-top">
              <b>${esc(c.name)}</b>
              <span>${c.confidence}% · ${esc(SEVERITY_LABEL[c.severity] || c.severity)}</span>
            </div>
            <div class="bar"><i style="width:${Math.max(4, Math.min(100, Number(c.confidence) || 0))}%"></i></div>
            ${c.note ? `<p class="cond-note">${esc(c.note)}</p>` : ''}
          </div>`).join('')
        : '<p class="cond-note">No strong cosmetic concern stood out in this photo.</p>'}

      ${r.screening && r.screening.available && r.screening.top && r.screening.top.length
        ? `<div class="ar-block">
             <b>Notebook model screening</b>
             <ul class="screen-top">${r.screening.top.map((t) => `<li>${esc(String(t.name).replace(/_/g, ' '))} — ${Math.round(t.confidence)}%</li>`).join('')}</ul>
             <p class="m-note" style="margin:6px 0 0">${esc(r.screening.note)}</p>
           </div>`
        : ''}

      ${r.care && r.care.note ? `<div class="ar-doc"><b>Care guidance.</b> ${esc(r.care.note)}</div>` : ''}

      <div class="ar-actions">
        <button data-action="find-care" type="button">✚ Find a dermatologist</button>
        <button data-action="find-hospital" type="button">🏥 Hospitals near me</button>
        <button data-action="book" type="button">📅 Book appointment</button>
        <button data-action="emergency" class="warn" type="button">☎ Emergency numbers</button>
      </div>

      ${routineHtml(r)}
      ${listBlock('Key suggestions', r.suggestions)}
      <div class="ar-disc">⚠ ${esc(r.disclaimer || 'This is informational AI output, not a medical diagnosis.')}</div>
      ${r.engine && r.engine.note ? `<p class="ar-engine">${esc(r.engine.note)}</p>` : ''}
      ${r.language && r.language !== 'en' ? '<p class="ar-engine">Detailed screening text is currently in English; your language preference is saved for future visits.</p>' : ''}
    </div>`;
}

function wireAnalysisActions(root, analysis) {
  const r = (analysis && analysis.result) || {};
  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.action) {
        case 'find-care': return goToCare('dermatologist');
        case 'find-hospital': return goToCare('hospital');
        case 'emergency': return openEmergency();
        case 'book': {
          const names = (r.conditions || []).map((c) => c.name).join(', ');
          return openBooking({
            type: 'doctor',
            reason: names ? `SkinSakhi screening: ${names}` : '',
          });
        }
        default: return undefined;
      }
    });
  });
}

async function analyzeSkin() {
  const resultBox = document.getElementById('result');
  const file = imageInput.files[0];
  if (!file) return showToast('Please upload a skin photo first.');
  if (!requireLogin()) return;

  const button = $('.analyze-button');
  button.disabled = true;
  resultBox.innerHTML = `
    <div class="result-empty">
      <div class="result-icon">⏳</div>
      <h3>Analyzing your skin...</h3>
      <p>SkinSakhi AI is processing your image. This can take up to a minute.</p>
    </div>`;

  try {
    const form = new FormData();
    form.append('image', file);
    form.append('language', currentLanguage());
    const symptoms = $$('.symptom-grid input:checked').map((i) => i.value);
    if (symptoms.length) form.append('symptoms', JSON.stringify(symptoms));

    const { analysis } = await api('/analysis', { method: 'POST', form });
    lastAnalysis = analysis;
    resultBox.innerHTML = analysisHtml(analysis);
    wireAnalysisActions(resultBox, analysis);

    const level = analysis.result && analysis.result.urgency ? analysis.result.urgency.level : 'routine';
    if (level === 'emergency') showToast('Warning signs detected. Please read the emergency guidance now.');
    else if (level === 'urgent') showToast('See a doctor within 24–48 hours. Use Find Care to book.');
    else showToast('Skin analysis completed!');
  } catch (err) {
    resultBox.innerHTML = `
      <div class="result-empty">
        <div class="result-icon">!</div>
        <h3>Could not analyze</h3>
        <p>${esc(err.message)}</p>
      </div>`;
    if (err.status === 401) requireLogin();
  } finally {
    button.disabled = false;
  }
}

const goTo = (id) => document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
function goToAnalysis() { goTo('analysis'); }
function goToServices() { goTo('services'); }

function setupScrollSpy() {
  const links = $$('.side-nav a[href^="#"]').filter((a) => a.getAttribute('href').length > 1);
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((l) => l.classList.remove('active'));
        map.get(en.target.id)?.classList.add('active');
      });
    },
    { rootMargin: '-40% 0px -50% 0px' }
  );
  map.forEach((_, id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
}


function closeModal() {
  document.getElementById('modal')?.remove();
}

function openModal(title, html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'm-overlay';
  overlay.id = 'modal';
  overlay.innerHTML = `
    <div class="m-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="m-head"><h3>${esc(title)}</h3><button class="m-x" type="button" aria-label="Close">×</button></div>
      <div class="m-body">${html}</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.m-x')) closeModal();
  });
  return $('.m-body', overlay);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });


function serviceMessage(service) {
  switch (service) {
    case 'Personalized Recommendations': return openRecommendations();
    case 'Product Recommendations': return openProducts('general');
    case 'Doctor & Hospital Appointment': return openAppointments('doctor');
    case 'Home Appointment': return openAppointments('home');
    case 'Beauty & Skin Clinic': return openAppointments('clinic');
    case 'Skin Journal': return openJournal();
    default: showToast(service + ' will be available soon.');
  }
}

const CONCERNS = {
  general: 'General care',
  dryness: 'Dryness / dehydration',
  acne: 'Acne / breakouts',
  oiliness: 'Oiliness',
  pigmentation: 'Pigmentation / dark spots',
  sensitivity: 'Sensitivity / redness',
  'sun-protection': 'Sun protection',
  aging: 'Fine lines / aging',
};

const productCards = (items) =>
  `<div class="m-products">${items.map((p) => `
    <div class="m-product">
      <b>${esc(p.name)}</b>
      <small>${esc(p.category)} · ${esc(p.key_ingredients)}</small>
      <p>${esc(p.usage_tip)}</p>
    </div>`).join('')}</div>
   <p class="m-note">These are product types and key ingredients, not brand endorsements. Check labels and patch-test new products.</p>`;

async function openProducts(initial) {
  const body = openModal('Product Recommendations', `
    <div class="m-form">
      <label>Skin concern
        <select id="pConcern">${Object.entries(CONCERNS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
    </div>
    <div id="pList">Loading...</div>`);
  const select = $('#pConcern', body);
  const list = $('#pList', body);
  select.value = initial;

  const load = async () => {
    list.textContent = 'Loading...';
    try {
      const data = await api('/products?concern=' + encodeURIComponent(select.value));
      list.innerHTML = data.items.length ? productCards(data.items) : '<p class="m-empty">No products found.</p>';
    } catch (err) {
      list.innerHTML = `<p class="m-empty">${esc(err.message)}</p>`;
    }
  };
  select.addEventListener('change', load);
  load();
}

async function openRecommendations() {
  if (!requireLogin()) return;
  try {
    const data = await api('/recommendations');
    const r = data.result;
    openModal('Your Personalized Plan', `
      <p class="m-note">Based on your analysis from ${esc(fmtDateTime(data.created_at))}${data.demo ? ' (demo result)' : ''}.</p>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
      ${routineHtml(r)}
      ${listBlock('Suggestions', r.suggestions)}
      <h4>Products to look for</h4>
      ${productCards(data.products)}`);
  } catch (err) {
    if (err.status === 404) {
      showToast('Analyze a skin photo first to get your plan.');
      goToAnalysis();
    } else {
      showToast(err.message);
    }
  }
}

const APPT_LABEL = {
  doctor: 'Dermatologist / Doctor',
  hospital: 'Hospital',
  clinic: 'Skin clinic',
  home: 'Home visit',
};

async function openAppointments(type) {
  if (!requireLogin()) return;
  const body = openModal('Appointments', `
    <form id="apForm" class="m-form">
      <label>Type
        <select name="type">${Object.entries(APPT_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>Doctor, clinic or hospital name (optional)
        <input name="provider" maxlength="120">
      </label>
      <label>Phone number (optional)
        <input name="phone" maxlength="40" inputmode="tel" placeholder="Clinic phone, if you have it">
      </label>
      <div class="m-row">
        <label>Date <input type="date" name="date" min="${ymd(new Date())}" required></label>
        <label>Time <input type="time" name="time" required></label>
      </div>
      <label id="apAddr" hidden>Home address
        <input name="address" maxlength="250">
      </label>
      <label>Reason (optional)
        <textarea name="reason" rows="2" maxlength="500"></textarea>
      </label>
      <button class="m-btn" type="submit">Request appointment</button>
      <p class="m-note">Your request is saved to your account. SkinSakhi does not contact the doctor or clinic for you yet, so please confirm the time directly with them.</p>
    </form>
    <h4>Your appointments</h4>
    <div id="apList">Loading...</div>`);

  const form = $('#apForm', body);
  const list = $('#apList', body);
  const typeSel = form.elements.type;
  typeSel.value = type;
  const syncAddr = () => { $('#apAddr', body).hidden = typeSel.value !== 'home'; };
  typeSel.addEventListener('change', syncAddr);
  syncAddr();

  async function loadList() {
    try {
      const { items } = await api('/appointments');
      list.innerHTML = items.length
        ? items.map((a) => `
          <div class="m-item">
            <div class="m-item-top">
              <div>
                <b>${esc(APPT_LABEL[a.type])}</b>
                <span class="chip ${a.status === 'requested' ? 'ok' : 'off'}">${esc(a.status)}</span><br>
                <small>${esc(fmtDay(a.appt_date))} at ${esc(a.appt_time)}${a.provider ? ' · ' + esc(a.provider) : ''}</small>
                ${a.address ? `<p>${esc(a.address)}</p>` : ''}
                ${a.reason ? `<p>${esc(a.reason)}</p>` : ''}
                ${a.phone ? `<a class="appt-call" href="tel:${a.phone.replace(/[^+\d]/g, '')}">☎ ${esc(a.phone)}</a>` : ''}
                ${a.maps_url ? `<a class="appt-call" href="${esc(a.maps_url)}" target="_blank" rel="noopener noreferrer"> · Directions →</a>` : ''}
              </div>
              ${a.status === 'requested' ? `<div class="m-actions"><button class="m-btn m-small m-danger" data-cancel="${a.id}" type="button">Cancel</button></div>` : ''}
            </div>
          </div>`).join('')
        : '<p class="m-empty">No appointments yet.</p>';
    } catch (err) {
      list.innerHTML = `<p class="m-empty">${esc(err.message)}</p>`;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    try {
      await api('/appointments', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      showToast('Appointment request saved.');
      form.reset();
      typeSel.value = type;
      syncAddr();
      loadList();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  list.addEventListener('click', async (e) => {
    const id = e.target.dataset.cancel;
    if (!id) return;
    try {
      await api(`/appointments/${id}/cancel`, { method: 'PATCH' });
      showToast('Appointment cancelled.');
      loadList();
    } catch (err) {
      showToast(err.message);
    }
  });

  loadList();
}


function setCareKind(kind) {
  careKind = ['dermatologist', 'hospital', 'clinic'].includes(kind) ? kind : 'dermatologist';
  $$('#careTabs button').forEach((b) => b.classList.toggle('on', b.dataset.kind === careKind));
}

function goToCare(kind) {
  if (kind) setCareKind(kind);
  goTo('care');
  const hasLocation = careOrigin || $('#careLocation').value.trim().length >= 2;
  if (hasLocation) searchCare();
  else showToast('Share your location or type a city to find care.');
}

async function searchCare(useCoords = false) {
  const results = $('#careResults');
  const location = $('#careLocation').value.trim();
  const params = new URLSearchParams({ kind: careKind, radius: $('#careRadius').value });

  if (useCoords && careOrigin) {
    params.set('lat', careOrigin.lat);
    params.set('lon', careOrigin.lon);
  } else if (location.length >= 2) {
    params.set('city', location);
    localStorage.setItem('ss_city', location);
  } else if (careOrigin) {
    params.set('lat', careOrigin.lat);
    params.set('lon', careOrigin.lon);
  } else {
    showToast('Enter a city/area or use your location.');
    return;
  }

  results.innerHTML = '<p class="care-empty">Searching for nearby care…</p>';
  try {
    const data = await api('/care/nearby?' + params.toString());
    careItems = data.items || [];
    careOrigin = data.origin;
    careCountry = (data.origin && data.origin.country_code) || careCountry;
    if (careCountry) localStorage.setItem('ss_country', careCountry);
    renderCare(data);
  } catch (err) {
    results.innerHTML = `<p class="care-empty">${esc(err.message)}</p>`;
  }
}

function useMyLocation() {
  if (!navigator.geolocation) return showToast('This browser does not support location.');
  showToast('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      careOrigin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      $('#careLocation').value = '';
      searchCare(true);
    },
    (err) => {
      showToast(err.code === 1
        ? 'Location permission was denied. Type a city instead.'
        : 'Could not get your location. Type a city instead.');
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
  );
}

const careTag = (text, hot) => `<span class="care-tag${hot ? ' hot' : ''}">${esc(text)}</span>`;

function renderCare(data) {
  const results = $('#careResults');
  const emergency = $('#careEmergency');
  const numbers = (data.emergency_numbers && data.emergency_numbers.numbers) || [];

  if (numbers.length) {
    emergency.hidden = false;
    emergency.innerHTML = `<b>Emergency numbers · ${esc(data.emergency_numbers.country)}</b>` +
      numbers.map((n) => `<a href="tel:${String(n.number).replace(/[^+\d]/g, '')}">${esc(n.label)}: ${esc(n.number)}</a>`).join('') +
      '<p class="m-note" style="margin:6px 0 0">For a life-threatening emergency, call now. SkinSakhi cannot dispatch help.</p>';
  } else {
    emergency.hidden = true;
  }

  if (!data.items.length) {
    results.innerHTML = `
      <p class="care-empty">
        ${esc(data.message || 'No places found in this area.')}
        <a href="${esc(data.maps_search_url)}" target="_blank" rel="noopener noreferrer">Open map search →</a>
      </p>`;
    return;
  }

  const where = data.origin.label ? ' near ' + data.origin.label.split(',').slice(0, 2).join(', ') : '';
  results.innerHTML = data.items.map((item, i) => {
    const tags = [];
    if (item.emergency) tags.push(careTag('Emergency department', true));
    if (item.kind === 'hospital') tags.push(careTag('Hospital'));
    else if (/derma/i.test(item.speciality || '')) tags.push(careTag('Dermatology'));
    if (item.opening_hours) tags.push(careTag(item.opening_hours));
    return `
      <div class="care-card">
        <div class="care-card-top">
          <h3>${esc(item.name)}</h3>
          <span class="care-dist">${esc(item.distance_km)} km</span>
        </div>
        <p class="care-addr">${esc(item.address || 'Address not listed. Use Directions for the exact location.')}</p>
        ${tags.length ? `<div class="care-tags">${tags.join('')}</div>` : ''}
        <div class="care-actions">
          <button class="primary" type="button" data-book="${i}">Book</button>
          ${item.phone ? `<a href="tel:${String(item.phone).replace(/[^+\d]/g, '')}">☎ Call</a>` : ''}
          <a href="${esc(item.maps_url)}" target="_blank" rel="noopener noreferrer">Directions</a>
          ${item.website ? `<a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}
        </div>
      </div>`;
  }).join('') + `
    <p class="care-source">
      ${data.count} result${data.count === 1 ? '' : 's'} within ${esc(data.radius_km)} km${esc(where)} ·
      Source: ${data.source === 'google' ? 'Google Places' : 'OpenStreetMap contributors'} ·
      Details may be missing or out of date, so call ahead.
      <a href="${esc(data.maps_search_url)}" target="_blank" rel="noopener noreferrer">Search the map →</a>
    </p>`;
}

// ---------- emergency ----------

function emergencyNumbersHtml(data) {
  const numbers = data.numbers || [];
  if (!numbers.length) {
    return `<p class="m-note">${esc(data.note || 'Emergency numbers differ by country. Check your phone’s emergency call screen for the local number.')}</p>`;
  }
  return `<p class="m-note">Emergency numbers for <b>${esc(data.country)}</b></p>
    <div class="em-grid">
      ${numbers.map((n) => `
        <a href="tel:${String(n.number).replace(/[^+\d]/g, '')}">
          <span>${esc(n.label)}</span>${esc(n.number)}
        </a>`).join('')}
    </div>`;
}

async function openEmergency() {
  const body = openModal('Emergency help', `
    <div class="urg urg-emergency">
      <b>If this is a medical emergency, call now.</b>
      <p>Do not wait for an online result. Emergency numbers depend on your country.</p>
    </div>
    <div id="emNumbers"><p class="m-note">Loading local emergency numbers…</p></div>
    <div class="em-actions">
      <button class="m-btn" id="emLocate" type="button">📍 Use my location</button>
      <button class="m-btn m-outline" id="emHospital" type="button">🏥 Find nearest hospital</button>
    </div>
    <h4>While waiting for help</h4>
    <ul>
      <li>Stay with the person and keep them calm.</li>
      <li>Do not put unknown creams or home remedies on broken skin.</li>
      <li>Swelling of the face or throat, trouble breathing or dizziness needs emergency services immediately.</li>
      <li>For a severe allergic reaction, use a prescribed adrenaline auto-injector and call emergency services.</li>
    </ul>
    <p class="m-note">SkinSakhi is not an emergency service and cannot dispatch help.</p>`);

  const numbersBox = $('#emNumbers', body);
  const locateBtn = $('#emLocate', body);

  $('#emHospital', body).addEventListener('click', () => {
    closeModal();
    setCareKind('hospital');
    goTo('care');
    if (careOrigin) searchCare(true);
    else useMyLocation();
  });

  const country = careCountry || localStorage.getItem('ss_country') || '';
  if (country) {
    try {
      numbersBox.innerHTML = emergencyNumbersHtml(await api('/care/emergency?country=' + encodeURIComponent(country)));
    } catch {
      numbersBox.innerHTML = '<p class="m-note">Could not load local numbers. Check your phone’s emergency call screen.</p>';
    }
  } else {
    numbersBox.innerHTML = '<p class="m-note">Tap “Use my location” to get the right emergency number, or check your phone’s emergency call screen.</p>';
  }

  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return showToast('This browser does not support location.');
    locateBtn.disabled = true;
    numbersBox.innerHTML = '<p class="m-note">Getting your location…</p>';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          careOrigin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          const data = await api(`/care/emergency?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
          careCountry = data.country_code || careCountry;
          localStorage.setItem('ss_country', careCountry);
          numbersBox.innerHTML = emergencyNumbersHtml(data);
        } catch (err) {
          numbersBox.innerHTML = `<p class="m-note">${esc(err.message)}</p>`;
        } finally {
          locateBtn.disabled = false;
        }
      },
      (err) => {
        locateBtn.disabled = false;
        numbersBox.innerHTML = `<p class="m-note">${err.code === 1 ? 'Location permission was denied.' : 'Could not get your location.'} Check your phone’s emergency call screen.</p>`;
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  });
}
async function openBooking(prefill = {}) {
  if (!requireLogin()) return;
  const p = prefill || {};
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const body = openModal(p.provider ? 'Book ' + p.provider : 'Book an appointment', `
    <form id="bkForm" class="m-form">
      <input type="hidden" name="care_type" value="${esc(p.care_type || '')}">
      <input type="hidden" name="maps_url" value="${esc(p.maps_url || '')}">
      <label>Appointment type
        <select name="type">
          ${Object.entries(APPT_LABEL).map(([k, v]) => `<option value="${k}"${(p.type || 'doctor') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>
      <label>Doctor / clinic / hospital
        <input name="provider" maxlength="120" value="${esc(p.provider || '')}">
      </label>
      <label>Phone (optional)
        <input name="phone" maxlength="40" inputmode="tel" value="${esc(p.phone || '')}" placeholder="Clinic or doctor phone">
      </label>
      <label>Address (optional)
        <input name="address" maxlength="250" value="${esc(p.address || '')}">
      </label>
      <div class="m-row">
        <label>Date <input type="date" name="date" min="${ymd(new Date())}" value="${ymd(tomorrow)}" required></label>
        <label>Time <input type="time" name="time" value="10:00" required></label>
      </div>
      <label>Reason (optional)
        <textarea name="reason" rows="2" maxlength="500">${esc(p.reason || '')}</textarea>
      </label>
      <button class="m-btn" type="submit">Request appointment</button>
      <p class="m-note">This saves a booking request in your account. Call the clinic to confirm the slot; SkinSakhi does not contact them for you.</p>
    </form>
    <div id="bkOut"></div>`);

  const form = $('#bkForm', body);
  const out = $('#bkOut', body);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    try {
      const { appointment } = await api('/appointments', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.remove();
      out.innerHTML = `
        <div class="urg urg-routine">
          <b>Appointment request saved</b>
          <p>${esc(APPT_LABEL[appointment.type] || appointment.type)} · ${esc(fmtDay(appointment.appt_date))} at ${esc(appointment.appt_time)}${appointment.provider ? ' · ' + esc(appointment.provider) : ''}</p>
        </div>
        ${appointment.phone ? `<a class="m-btn" href="tel:${String(appointment.phone).replace(/[^+\d]/g, '')}">☎ Call ${esc(appointment.phone)}</a> ` : ''}
        ${appointment.maps_url ? `<a class="m-btn m-outline" href="${esc(appointment.maps_url)}" target="_blank" rel="noopener noreferrer">Directions →</a> ` : ''}
        <button class="m-btn m-outline" type="button" id="bkList">View my appointments</button>
        <p class="m-note">Call the clinic to confirm the time. If this is urgent, do not wait for a confirmation.</p>`;
      $('#bkList', out).addEventListener('click', () => {
        closeModal();
        openAppointments(appointment.type);
      });
      showToast('Appointment request saved.');
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}


const MOOD_LABEL = { great: 'Great', good: 'Good', okay: 'Okay', low: 'Low', irritated: 'Irritated' };

async function openJournal() {
  if (!requireLogin()) return;
  const body = openModal('Skin Journal', `
    <div class="m-tabs">
      <button type="button" data-tab="notes" class="on">Daily Notes</button>
      <button type="button" data-tab="history">Analysis History</button>
    </div>
    <div id="jPane"></div>`);
  const pane = $('#jPane', body);

  $$('.m-tabs button', body).forEach((b) =>
    b.addEventListener('click', () => {
      $$('.m-tabs button', body).forEach((x) => x.classList.toggle('on', x === b));
      (b.dataset.tab === 'notes' ? showNotes : showHistory)(pane);
    })
  );
  showNotes(pane);
}

async function showNotes(pane) {
  pane.innerHTML = `
    <form id="jForm" class="m-form">
      <label>How is your skin today?
        <textarea name="note" rows="3" maxlength="2000" required placeholder="Write a note..."></textarea>
      </label>
      <label>Mood
        <select name="mood">
          <option value="">Not set</option>
          ${Object.entries(MOOD_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
      </label>
      <button class="m-btn" type="submit">Add note</button>
    </form>
    <h4>Your notes</h4>
    <div id="jList">Loading...</div>`;
  const form = $('#jForm', pane);
  const list = $('#jList', pane);

  async function load() {
    try {
      const { items } = await api('/journal');
      list.innerHTML = items.length
        ? items.map((n) => `
          <div class="m-item">
            <div class="m-item-top">
              <div>
                <small>${esc(fmtDateTime(n.created_at))}</small>${n.mood ? `<span class="chip">${esc(MOOD_LABEL[n.mood])}</span>` : ''}
                <p>${esc(n.note)}</p>
              </div>
              <div class="m-actions"><button class="m-btn m-small m-danger" data-del="${n.id}" type="button">Delete</button></div>
            </div>
          </div>`).join('')
        : '<p class="m-empty">No notes yet. Add your first one above.</p>';
    } catch (err) {
      list.innerHTML = `<p class="m-empty">${esc(err.message)}</p>`;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/journal', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      load();
    } catch (err) {
      showToast(err.message);
    }
  });
  list.addEventListener('click', async (e) => {
    const id = e.target.dataset.del;
    if (!id || !confirm('Delete this note?')) return;
    try { await api('/journal/' + id, { method: 'DELETE' }); load(); } catch (err) { showToast(err.message); }
  });
  load();
}

async function showHistory(pane) {
  pane.innerHTML = '<div id="hList">Loading...</div>';
  const list = $('#hList', pane);

  async function load() {
    try {
      const { items, total } = await api('/analysis?limit=50');
      list.innerHTML = items.length
        ? `<p class="m-note">${total} saved ${total === 1 ? 'analysis' : 'analyses'}</p>` + items.map((a) => `
          <div class="m-item">
            <div class="m-item-top">
              <div>
                <small>${esc(fmtDateTime(a.created_at))}</small>${a.demo ? '<span class="chip off">demo</span>' : ''}
                ${a.score !== undefined && a.score !== null ? `<span class="chip">Score ${esc(a.score)}/100</span>` : ''}
                ${a.urgency && a.urgency !== 'routine' ? `<span class="chip off">${esc(a.urgency)}</span>` : ''}
                <p>${esc(a.concerns.length ? a.concerns.join(', ') : 'No concerns noted')}</p>
              </div>
              <div class="m-actions">
                <button class="m-btn m-small m-outline" data-view="${a.id}" type="button">View</button>
                <button class="m-btn m-small m-danger" data-del="${a.id}" type="button">Delete</button>
              </div>
            </div>
          </div>`).join('')
        : '<p class="m-empty">No analyses yet. Upload a photo to create your first one.</p>';
    } catch (err) {
      list.innerHTML = `<p class="m-empty">${esc(err.message)}</p>`;
    }
  }

  list.addEventListener('click', async (e) => {
    const { view, del } = e.target.dataset;
    try {
      if (view) {
        const { analysis } = await api('/analysis/' + view);
        pane.innerHTML = `
          <button class="m-btn m-small m-outline" id="hBack" type="button">← Back to history</button>
          <p class="m-note">${esc(fmtDateTime(analysis.created_at))}</p>
          <img class="m-thumb" src="/api/analysis/${analysis.id}/image" alt="Analyzed skin photo">
          ${analysisHtml(analysis)}`;
        wireAnalysisActions(pane, analysis);
        $('#hBack', pane).addEventListener('click', () => showHistory(pane));
      } else if (del && confirm('Delete this analysis and its photo permanently?')) {
        await api('/analysis/' + del, { method: 'DELETE' });
        load();
      }
    } catch (err) {
      showToast(err.message);
    }
  });
  load();
}

function startTrek() {
  const today = new Date();
  const last = new Date();
  last.setDate(today.getDate() + 6);

  const body = openModal('Trek Planner', `
    <form id="tForm" class="m-form">
      <label>Trek location
        <input name="location" required minlength="2" maxlength="100" placeholder="e.g. Manali, Himachal Pradesh">
      </label>
      <div class="m-row">
        <label>Date <input type="date" name="date" min="${ymd(today)}" max="${ymd(last)}" value="${ymd(today)}"></label>
        <label>Trail altitude in metres (optional) <input type="number" name="altitude" min="0" max="9000" step="50"></label>
      </div>
      <button class="m-btn" type="submit">Get skin &amp; UV guidance</button>
      <p class="m-note">Uses a free weather forecast for the next 7 days. If you leave altitude empty, the town's elevation is used.</p>
    </form>
    <div id="tOut"></div>`);

  const form = $('#tForm', body);
  const out = $('#tOut', body);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    out.innerHTML = '<p class="m-note">Checking the forecast...</p>';
    try {
      const { plan } = await api('/trek/plan', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      const d = plan.day;
      out.innerHTML = `
        <h4>${esc(plan.place)} · ${esc(fmtDay(plan.date))}</h4>
        <div class="tp-grid">
          <div><b>${esc(plan.uv_adjusted)}</b><span>UV · ${esc(plan.uv_label)}</span></div>
          <div><b>${esc(Math.round(d.temp_min))}° / ${esc(Math.round(d.temp_max))}°C</b><span>Low / High</span></div>
          <div><b>${esc(d.rain_prob)}%</b><span>Rain chance</span></div>
          <div><b>${esc(Math.round(d.wind_max))}</b><span>Wind km/h</span></div>
        </div>
        <p class="m-note">UV is adjusted for about ${esc(plan.altitude_used)} m altitude.</p>
        <ul class="tp-tips">${plan.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    } catch (err) {
      out.innerHTML = `<p class="m-empty">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

// Trek checklist: saved per account
const KEYS = ['sunscreen', 'hydration', 'sun-protection', 'moisturizer', 'lip-protection'];
let loggedInHintShown = false;

async function setupChecklist() {
  const boxes = $$('.trek-checklist input[type="checkbox"]');
  boxes.forEach((box, i) => {
    box.addEventListener('change', async () => {
      if (!me) {
        if (!loggedInHintShown) { showToast('Log in to save your checklist.'); loggedInHintShown = true; }
        return;
      }
      try {
        await api('/trek/checklist', { method: 'PUT', body: { item: KEYS[i], checked: box.checked } });
      } catch (err) {
        box.checked = !box.checked;
        showToast(err.message);
      }
    });
  });
  if (!me) return;
  try {
    const { items } = await api('/trek/checklist');
    items.forEach((it) => {
      const i = KEYS.indexOf(it.key);
      if (boxes[i]) boxes[i].checked = it.checked;
    });
  } catch { /* checklist just stays unchecked */ }
}

function setupCare() {
  const tabs = $('#careTabs');
  if (!tabs) return;

  const savedCity = localStorage.getItem('ss_city');
  if (savedCity) $('#careLocation').value = savedCity;

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    setCareKind(btn.dataset.kind);
    if (careOrigin || $('#careLocation').value.trim().length >= 2) searchCare(!!careOrigin && !$('#careLocation').value.trim());
  });

  $('#careLocation').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchCare();
    }
  });

  $('#careResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-book]');
    if (!btn) return;
    const item = careItems[Number(btn.dataset.book)];
    if (!item) return;
    openBooking({
      type: item.kind === 'hospital' ? 'hospital' : 'doctor',
      provider: item.name,
      address: item.address,
      phone: item.phone,
      maps_url: item.maps_url,
      care_type: careKind,
      reason: 'Booking from SkinSakhi care finder',
    });
  });
}


(async function init() {
  try {
    me = (await api('/auth/me')).user;
  } catch {
    me = null;
  }
  languageSelect.value = (me && me.language) || localStorage.getItem('ss_lang') || 'en';
  careCountry = localStorage.getItem('ss_country') || '';
  renderUser();
  setupScrollSpy();
  setupChecklist();
  setupCare();
})();
