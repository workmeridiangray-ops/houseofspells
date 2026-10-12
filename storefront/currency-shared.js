// ============================================================
// Lunar & Lore — Currency Detection Module
// Detects the visitor's country via IP geolocation and shows
// prices in their local currency. Falls back to INR if detection
// fails or the visitor is in India.
// ============================================================

const CURRENCY_STORAGE_KEY = 'lunar_lore_currency_v1';

// Static approximate conversion rates from INR (base currency, since that's
// what the catalog is priced in). In production, fetch live rates from a
// service like exchangerate-api.com or wise.com's API instead of hardcoding.
const CONVERSION_RATES = {
  INR: { rate: 1,        symbol: '₹',  locale: 'en-IN' },
  USD: { rate: 0.012,    symbol: '$',  locale: 'en-US' },
  GBP: { rate: 0.0095,   symbol: '£',  locale: 'en-GB' },
  EUR: { rate: 0.011,    symbol: '€',  locale: 'de-DE' },
  AUD: { rate: 0.018,    symbol: 'A$', locale: 'en-AU' },
  CAD: { rate: 0.016,    symbol: 'C$', locale: 'en-CA' },
  AED: { rate: 0.044,    symbol: 'AED ', locale: 'en-AE' },
  SGD: { rate: 0.016,    symbol: 'S$', locale: 'en-SG' },
};

// Maps ISO country codes to a currency. Countries not listed fall back to USD.
const COUNTRY_TO_CURRENCY = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  AU: 'AUD',
  CA: 'CAD',
  AE: 'AED',
  SG: 'SGD',
  // Eurozone countries
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR',
  AT: 'EUR', IE: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
};

let currentCurrency = { code: 'INR', ...CONVERSION_RATES.INR, countryCode: 'IN', detected: false };

function getStoredCurrency() {
  try {
    const raw = localStorage.getItem(CURRENCY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function storeCurrency(data) {
  try {
    localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {}
}

async function detectCurrency() {
  // Checkout charges in INR only, so prices are always shown in INR.
  currentCurrency = { code: 'INR', ...CONVERSION_RATES.INR, countryCode: 'IN', detected: false };
  applyCurrencyToPage();
  return currentCurrency;

  // 1. Use a cached detection from earlier in this session/browser if present
  const cached = getStoredCurrency();
  if (cached && cached.code) {
    currentCurrency = cached;
    applyCurrencyToPage();
    return currentCurrency;
  }

  // 2. Try IP-based geolocation (ipapi.co free tier — no key needed for low volume).
  //    In production, replace with a paid/reliable geolocation service and
  //    ideally resolve this server-side to avoid client-side API limits.
  try {
    const resp = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json();
      const countryCode = data.country_code;
      const currencyCode = COUNTRY_TO_CURRENCY[countryCode] || 'USD';
      const info = CONVERSION_RATES[currencyCode] || CONVERSION_RATES.USD;
      currentCurrency = { code: currencyCode, ...info, countryCode: countryCode, detected: true };
      storeCurrency(currentCurrency);
      applyCurrencyToPage();
      return currentCurrency;
    }
  } catch (e) {
    // geolocation failed or timed out — fall through to browser-locale guess
  }

  // 3. Fallback: guess from the browser's own locale setting (fast, no network,
  //    less reliable than IP geolocation but better than nothing).
  try {
    const locale = navigator.language || 'en-IN';
    const region = locale.split('-')[1];
    if (region && COUNTRY_TO_CURRENCY[region]) {
      const currencyCode = COUNTRY_TO_CURRENCY[region];
      const info = CONVERSION_RATES[currencyCode];
      currentCurrency = { code: currencyCode, ...info, countryCode: region, detected: true };
      storeCurrency(currentCurrency);
    }
  } catch (e) {}

  applyCurrencyToPage();
  return currentCurrency;
}

// Converts a price stored in INR (the catalog's base currency) to the
// visitor's detected currency and formats it for display.
function fmtLocal(inrAmount) {
  const converted = inrAmount * currentCurrency.rate;
  // Whole numbers for most currencies; INR keeps Indian digit grouping.
  const rounded = currentCurrency.code === 'INR' ? Math.round(converted) : Math.round(converted * 100) / 100;
  try {
    return new Intl.NumberFormat(currentCurrency.locale, {
      style: 'currency',
      currency: currentCurrency.code,
      maximumFractionDigits: currentCurrency.code === 'INR' ? 0 : 2,
    }).format(rounded);
  } catch (e) {
    return currentCurrency.symbol + rounded.toLocaleString();
  }
}

// Converts an INR amount into the smallest currency unit Razorpay expects
// (paise for INR, cents for USD/EUR/etc.) for the given currency code.
function toRazorpaySubunit(inrAmount, currencyCode) {
  const info = CONVERSION_RATES[currencyCode] || CONVERSION_RATES.INR;
  const converted = inrAmount * info.rate;
  return Math.round(converted * 100);
}

// Re-renders any elements on the page carrying a data-inr-price attribute
// to show the converted, formatted price in the visitor's currency.
function applyCurrencyToPage() {
  document.querySelectorAll('[data-inr-price]').forEach(el => {
    const inr = parseFloat(el.getAttribute('data-inr-price'));
    if (!isNaN(inr)) {
      el.textContent = fmtLocal(inr);
    }
  });
  const badge = document.getElementById('currencyBadge');
  if (badge) {
    badge.textContent = currentCurrency.code;
    badge.style.display = currentCurrency.code === 'INR' ? 'none' : 'inline-flex';
  }
  // Sync the checkout page's country selector to the detected country,
  // if that field exists and hasn't already been changed by the visitor.
  const countryEl = document.getElementById('country');
  if (countryEl && !countryEl.dataset.userChanged && currentCurrency.countryCode) {
    const hasOption = Array.from(countryEl.options).some(o => o.value === currentCurrency.countryCode);
    countryEl.value = hasOption ? currentCurrency.countryCode : 'OTHER';
    if (typeof updateAddressFieldsForCountry === 'function') updateAddressFieldsForCountry();
  }
}

function setCurrencyManually(code) {
  const info = CONVERSION_RATES[code];
  if (!info) return;
  currentCurrency = { code, ...info, countryCode: currentCurrency.countryCode, detected: true, manual: true };
  storeCurrency(currentCurrency);
  applyCurrencyToPage();
}

// Kick off detection as soon as this script loads
detectCurrency();
