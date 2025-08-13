// DOM refs
const amountEl   = document.getElementById('amount');
const fromEl     = document.getElementById('from');
const toEl       = document.getElementById('to');
const resultEl   = document.getElementById('result');
const rateTextEl = document.getElementById('rateText');
const statusEl   = document.getElementById('status');
const swapBtn    = document.getElementById('swapBtn');
const convertBtn = document.getElementById('convertBtn');
const clearBtn   = document.getElementById('clearBtn');

// Simple storage helpers
const STORAGE_KEY_RATES = 'cc_rates_usd_v1';
const STORAGE_KEY_META  = 'cc_rates_meta_v1';
const STORAGE_KEY_PREFS = 'cc_prefs_v1';

// In-memory cache of USD-based rates
let ratesUSD = null;
let lastUpdated = null;

init().catch(err => {
  console.error(err);
  setStatus('Unexpected error during init.');
});

// ---------- Init ----------
async function init() {
  loadPrefs();
  await ensureRatesUSD();
  await populateCurrencies();
  // Defaults: if none saved, aim for USD -> INR (handy for India)
  if (!fromEl.value) fromEl.value = 'USD';
  if (!toEl.value)   toEl.value   = 'INR';
  updateRateText();
  convertNow();

  // Events
  swapBtn.addEventListener('click', () => {
    const t = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = t;
    savePrefs();
    updateRateText();
    convertNow();
  });

  convertBtn.addEventListener('click', () => {
    savePrefs();
    convertNow();
  });

  clearBtn.addEventListener('click', () => {
    amountEl.value = '';
    resultEl.value = '';
    rateTextEl.textContent = 'Amount cleared.';
    setStatus('');
  });

  amountEl.addEventListener('input', debounce(() => {
    savePrefs();
    convertNow();
  }, 250));

  fromEl.addEventListener('change', () => { savePrefs(); updateRateText(); convertNow(); });
  toEl.addEventListener('change',   () => { savePrefs(); updateRateText(); convertNow(); });

  // Enter key converts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { savePrefs(); convertNow(); }
  });
}

// ---------- Rates loading (robust with fallback) ----------
async function ensureRatesUSD() {
  // Try local cache if < 12 hours old
  try {
    const cache = localStorage.getItem(STORAGE_KEY_RATES);
    const meta  = localStorage.getItem(STORAGE_KEY_META);
    if (cache && meta) {
      const parsed = JSON.parse(cache);
      const metaObj = JSON.parse(meta);
      const ageMs = Date.now() - metaObj.savedAt;
      if (ageMs < 12 * 60 * 60 * 1000 && parsed && parsed.USD === 1) {
        ratesUSD = parsed;
        lastUpdated = metaObj.lastUpdatedStr || new Date(metaObj.savedAt).toUTCString();
        setStatus('Loaded cached rates.');
        return;
      }
    }
  } catch (_) {}

  // Fresh fetch: primary (open.er-api), then fallback (exchangerate.host)
  setStatus('Fetching latest rates…');

  // Primary
  try {
    const url = 'https://open.er-api.com/v6/latest/USD';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Primary source HTTP error');
    const data = await res.json();
    if (data && data.result === 'success' && data.rates && data.rates.USD === 1) {
      ratesUSD = data.rates;
      lastUpdated = data.time_last_update_utc || new Date().toUTCString();
      cacheRates();
      setStatus('Rates updated (primary).');
      return;
    }
    throw new Error('Primary source invalid payload');
  } catch (e) {
    console.warn('Primary source failed:', e);
  }

  // Fallback
  try {
    const url = 'https://api.exchangerate.host/latest?base=USD';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fallback source HTTP error');
    const data = await res.json();
    if (data && data.rates && data.rates.USD === 1) {
      ratesUSD = data.rates;
      lastUpdated = data.date || new Date().toUTCString();
      cacheRates();
      setStatus('Rates updated (fallback).');
      return;
    }
    throw new Error('Fallback source invalid payload');
  } catch (e) {
    console.error('Fallback source failed:', e);
    setStatus('Could not fetch live rates. Using last known data, if available.');
    // If we still have nothing, provide a minimal set to avoid total failure.
    if (!ratesUSD) {
      ratesUSD = { USD: 1 };
    }
  }
}

function cacheRates() {
  try {
    localStorage.setItem(STORAGE_KEY_RATES, JSON.stringify(ratesUSD));
    localStorage.setItem(STORAGE_KEY_META, JSON.stringify({
      savedAt: Date.now(),
      lastUpdatedStr: lastUpdated
    }));
  } catch (_) {}
}

// ---------- UI population ----------
async function populateCurrencies() {
  const codes = Object.keys(ratesUSD).sort();
  fillSelect(fromEl, codes);
  fillSelect(toEl, codes);
  // restore prefs if available
  const prefs = getPrefs();
  if (prefs) {
    if (codes.includes(prefs.from)) fromEl.value = prefs.from;
    if (codes.includes(prefs.to))   toEl.value   = prefs.to;
    if (prefs.amount) amountEl.value = prefs.amount;
  }
}

function fillSelect(selectEl, codes) {
  selectEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const code of codes) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    frag.appendChild(opt);
  }
  selectEl.appendChild(frag);
}

// ---------- Conversion ----------
function convertNow() {
  const amt = parseFloat(amountEl.value);
  const from = fromEl.value;
  const to = toEl.value;

  if (isNaN(amt) || amt <= 0) {
    resultEl.value = '';
    rateTextEl.textContent = 'Enter a valid amount (> 0).';
    return;
  }
  if (!ratesUSD[from] || !ratesUSD[to]) {
    resultEl.value = '';
    rateTextEl.textContent = 'Selected currency not available in rates.';
    return;
  }

  // Cross rate via USD base: to/from
  const rate = ratesUSD[to] / ratesUSD[from];
  const converted = amt * rate;

  resultEl.value = formatNumber(converted);
  rateTextEl.textContent = `1 ${from} = ${formatNumber(rate, 6)} ${to}  •  Last update: ${lastUpdated}`;
  setStatus('');
}

function updateRateText() {
  const from = fromEl.value;
  const to = toEl.value;
  if (ratesUSD && ratesUSD[from] && ratesUSD[to]) {
    const rate = ratesUSD[to] / ratesUSD[from];
    rateTextEl.textContent = `1 ${from} = ${formatNumber(rate, 6)} ${to}  •  Last update: ${lastUpdated}`;
  }
}

// ---------- Helpers ----------
function formatNumber(n, maxFrac = 2) {
  // Show up to maxFrac decimals, trim trailing zeros.
  const opts = { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 };
  return Number(n).toLocaleString(undefined, opts);
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function debounce(fn, wait=250){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

// ---------- Prefs ----------
function savePrefs(){
  try {
    localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify({
      from: fromEl.value,
      to: toEl.value,
      amount: amountEl.value
    }));
  } catch (_) {}
}
function getPrefs(){
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_PREFS) || 'null');
  } catch(_) { return null; }
}
function loadPrefs(){
  const p = getPrefs();
  if (p) {
    if (p.amount) amountEl.value = p.amount;
  }
}