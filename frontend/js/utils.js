/* utils.js — formatting, validation, DOM + a11y helpers, tiny UI kit.
 * No dependency on store/api so every other module can import it safely.
 */

/* ------------------------------------------------------------ constants */

export const LIMITS = {
  email: 200,
  passwordMin: 8,
  passwordMax: 72,
  displayName: 100,
  search: 50,
  address: 200,
  prompt: 300,
  dishName: 120,
  dishDescription: 500,
  protein: 120,
  imageUrl: 300,
  optionName: 60,
  groupName: 60,
  maxQuantity: 10000,
  uploadBytes: 5 * 1024 * 1024,
};

export const CATEGORIES = ['Chinese', 'Western', 'Japanese', 'Light Meal', 'Korean', 'Southeast Asian'];
export const SPICE_LEVELS = ['None', 'Mild', 'Medium', 'Hot'];
export const ALLERGENS = ['Peanuts', 'Dairy', 'Egg', 'Gluten', 'Soy', 'Fish', 'Shellfish'];
export const TASTES = ['Light', 'Balanced', 'Rich'];
export const MEAL_PERIODS = ['LUNCH', 'DINNER'];
export const ORDER_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];

/* --------------------------------------------------------------- money */

/** Format integer cents as `¥22.00`. Never uses float arithmetic. */
export function formatCents(cents, symbol = '¥') {
  const n = Number(cents);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${symbol}${whole}.${frac}`;
}

/** `+¥3.00` for option extras (empty string when there is no extra). */
export function formatExtraCents(cents) {
  const n = Number(cents) || 0;
  return n > 0 ? `+${formatCents(n)}` : '';
}

/** Parse a user typed price into integer cents. Returns null when invalid. */
export function parsePriceToCents(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[¥,\s]/g, '').trim();
  if (s === '') return null;
  if (!/^\d{0,7}(\.\d{0,2})?$/.test(s)) return null;
  if (s === '.') return null;
  const parts = s.split('.');
  const whole = parts[0] === '' ? '0' : parts[0];
  const frac = ((parts[1] || '') + '00').slice(0, 2);
  const cents = Number(whole) * 100 + Number(frac);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents → value for a ¥ text input, e.g. 2250 → "22.50". */
export function centsToInputValue(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  return (Math.round(Number(cents)) / 100).toFixed(2);
}

/** Sum a list of cent amounts, tolerating nulls. */
export function sumCents(list) {
  return (list || []).reduce((acc, n) => acc + (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0), 0);
}

/* ---------------------------------------------------------------- text */

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(value, max) {
  const s = value === null || value === undefined ? '' : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function capitalize(value) {
  const s = String(value || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ');
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
}

/** Options list → `Whole Wheat · Mustard · Cheese +¥3.00` */
export function optionsSummary(options) {
  if (!options || !options.length) return '';
  return options
    .map((o) => {
      const name = o.optionName || o.name || '';
      const extra = Number(o.extraPriceCents || 0);
      return extra > 0 ? `${name} ${formatExtraCents(extra)}` : name;
    })
    .join(' · ');
}

/* ------------------------------------------------------------ validate */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(value) {
  const v = String(value || '').trim();
  if (!v) return 'Email is required.';
  if (v.length > LIMITS.email) return `Email must be at most ${LIMITS.email} characters.`;
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address, e.g. name@company.com.';
  return '';
}

export function validatePassword(value, { required = true } = {}) {
  const v = String(value || '');
  if (!v) return required ? 'Password is required.' : '';
  if (v.length < LIMITS.passwordMin) return `Password must be at least ${LIMITS.passwordMin} characters.`;
  if (v.length > LIMITS.passwordMax) return `Password must be at most ${LIMITS.passwordMax} characters.`;
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Password must contain at least one letter and one digit.';
  return '';
}

export function validateDisplayName(value) {
  const v = String(value || '').trim();
  if (!v) return 'Display name is required.';
  if (v.length > LIMITS.displayName) return `Display name must be at most ${LIMITS.displayName} characters.`;
  return '';
}

export function validateAddress(value) {
  const v = String(value || '').trim();
  if (!v) return 'Delivery address is required.';
  if (v.length > LIMITS.address) return `Address must be at most ${LIMITS.address} characters.`;
  return '';
}

export function validateSearch(value) {
  const v = String(value || '');
  if (v.length > LIMITS.search) return `Search must be at most ${LIMITS.search} characters.`;
  return '';
}

export function validatePrompt(value) {
  const v = String(value || '').trim();
  if (!v) return 'Please describe what you feel like eating.';
  if (v.length > LIMITS.prompt) return `Keep it under ${LIMITS.prompt} characters.`;
  return '';
}

export function validateBudgets(minCents, maxCents) {
  const errs = {};
  const inRange = (c) => c === null || c === undefined || (c >= 0 && c <= 100000);
  if (!inRange(minCents)) errs.budgetMinCents = 'Minimum budget must be between ¥0.00 and ¥1000.00.';
  if (!inRange(maxCents)) errs.budgetMaxCents = 'Maximum budget must be between ¥0.00 and ¥1000.00.';
  if (!errs.budgetMinCents && !errs.budgetMaxCents && minCents !== null && maxCents !== null && minCents > maxCents) {
    errs.budgetMinCents = 'Minimum budget cannot be greater than the maximum.';
  }
  return errs;
}

/** Set or clear an inline field error. */
export function setFieldError(form, name, message) {
  const input = form.querySelector(`[name="${name}"]`);
  const slot = form.querySelector(`[data-error-for="${name}"]`);
  if (input && input.matches('input, select, textarea')) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (slot) slot.textContent = message || '';
}

export function clearFieldErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.setAttribute('aria-invalid', 'false'));
}

export function applyFieldErrors(form, fieldErrors) {
  clearFieldErrors(form);
  let first = null;
  Object.entries(fieldErrors || {}).forEach(([name, message]) => {
    setFieldError(form, name, message);
    if (!first) first = form.querySelector(`[name="${name}"]`);
  });
  if (first && typeof first.focus === 'function') first.focus();
  return Boolean(first);
}

/* --------------------------------------------------------- timing / async */

export function debounce(fn, wait = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  wrapped.flush = (...args) => { clearTimeout(timer); timer = null; fn(...args); };
  return wrapped;
}

export function throttle(fn, wait = 250, { leading = true, trailing = true } = {}) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return (...args) => {
    const now = Date.now();
    lastArgs = args;
    if (leading && now - last >= wait) {
      last = now;
      fn(...args);
      return;
    }
    if (trailing && !timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...lastArgs);
      }, Math.max(0, wait - (now - last)));
    }
  };
}

const clickGates = new WeakMap();

/** True when the same element was activated again inside `ms` (repeat-click guard). */
export function isRepeatClick(el, ms = 250) {
  const now = Date.now();
  const last = clickGates.get(el) || 0;
  if (now - last < ms) return true;
  clickGates.set(el, now);
  return false;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mark a button as busy without losing its label. */
export function setBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    if (!button.disabled) button.dataset.wasDisabled = 'false';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-loading');
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${escapeHtml(busyLabel)}</span>`;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

/* --------------------------------------------------------------- dates */

function pad2(n) { return String(n).padStart(2, '0'); }

export function todayStr(base = new Date()) {
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

export function shiftDate(dateStr, days) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

export function tomorrowStr() { return shiftDate(todayStr(), 1); }

export function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatWeekday(dateStr) {
  return parseDate(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
}

export function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${formatTime(value)}`;
}

export function dayLabel(dateStr) {
  if (!dateStr) return '—';
  const today = todayStr();
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrowStr()) return 'Tomorrow';
  if (dateStr === shiftDate(today, -1)) return 'Yesterday';
  return formatDateShort(dateStr);
}

export function mealPeriodLabel(period) {
  if (period === 'LUNCH') return 'Lunch';
  if (period === 'DINNER') return 'Dinner';
  return '—';
}

export function spiceLabel(level) {
  if (!level || level === 'None') return 'No spice';
  return `${level} spice`;
}

/* ----------------------------------------------------------- ui helpers */

export const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="12" y="8" width="3" height="9" rx="1"/><rect x="17" y="5" width="3" height="12" rx="1"/></svg>',
  dish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  calendarMenu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3M8 17.5h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.2v.2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.4 2.4 2.4 4.6-5"/></svg>',
  xCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c1.3-3.5 4.1-5.2 7.5-5.2s6.2 1.7 7.5 5.2"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M4 16v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5 8 12l6.5 7"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5 16 12l-6.5 7"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16M6.5 18c0-3 2.4-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><path d="M12 12.5V9M9 5.5h6"/></svg>',
  clockOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2M5 5l14 14"/></svg>',
};

export function icon(name, cls = '') {
  const svg = ICONS[name] || '';
  return svg.replace('<svg ', `<svg class="${cls}" aria-hidden="true" focusable="false" `);
}

export function spinnerHtml(label = 'Loading…') {
  return `<div class="loading-block"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span></div>`;
}

export function skeletonCards(count = 6) {
  return `<div class="dish-grid" aria-hidden="true">${Array.from({ length: count })
    .map(() => `<div class="skeleton sk-card"></div>`)
    .join('')}</div>`;
}

export function skeletonLines(count = 4) {
  const widths = ['92%', '76%', '84%', '64%', '70%', '58%'];
  return `<div class="card card-pad" aria-hidden="true">${Array.from({ length: count })
    .map((_, i) => `<div class="skeleton sk-line" style="width:${widths[i % widths.length]}"></div>`)
    .join('')}</div>`;
}

export function emptyStateHtml({ title = 'Nothing here yet', message = '', actionLabel = '', actionAttrs = '', iconName = 'empty' } = {}) {
  return `<div class="card empty-state">
    ${icon(iconName)}
    <h3>${escapeHtml(title)}</h3>
    ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
    ${actionLabel ? `<button class="btn btn-primary" ${actionAttrs}>${escapeHtml(actionLabel)}</button>` : ''}
  </div>`;
}

export function errorStateHtml({ title = 'Something went wrong', message = '', retryLabel = 'Try again', retryAttrs = 'data-retry' } = {}) {
  return `<div class="card empty-state error-state">
    ${icon('alert')}
    <h3>${escapeHtml(title)}</h3>
    <p class="muted">${escapeHtml(message)}</p>
    <button class="btn btn-outline" ${retryAttrs}>${escapeHtml(retryLabel)}</button>
  </div>`;
}

/** Remaining stock of a dish/menu item as a number, or null when unknown. */
export function remainingOf(item) {
  const raw = item ? item.remaining : null;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function stockView(item) {
  const remaining = remainingOf(item);
  if (item && item.soldOut) return { text: 'Sold out', cls: 'is-out' };
  if (remaining === null) return { text: '', cls: '' };
  if (remaining <= 0) return { text: 'Sold out', cls: 'is-out' };
  if (remaining <= 3) return { text: `Only ${remaining} left`, cls: 'is-low' };
  return { text: `${remaining} left`, cls: '' };
}

export const STATUS_CLASS = {
  Pending: 'badge-warn',
  Confirmed: 'badge-info',
  Completed: 'badge-ok',
  Cancelled: 'badge-neutral',
};

export function statusBadge(status) {
  const cls = STATUS_CLASS[status] || 'badge-neutral';
  return `<span class="badge ${cls}">${escapeHtml(status || 'Unknown')}</span>`;
}

export function stockBadge(item) {
  const view = stockView(item);
  if (!view.text) return '';
  return `<span class="badge badge-stock ${view.cls}">${escapeHtml(view.text)}</span>`;
}

/** Inner HTML for a `.pager` element: Prev, windowed page numbers, Next, info line. */
export function pagerHtml({ page = 0, totalPages = 1, info = '', prevLabel = 'Prev', nextLabel = 'Next' } = {}) {
  const pages = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const last = pages - 1;
  const infoLine = info ? `<p class="pager-info">${escapeHtml(info)}</p>` : '';
  if (pages <= 1) return infoLine;

  const numbers = new Set([0, last]);
  for (let i = current - 1; i <= current + 1; i += 1) {
    if (i > 0 && i < last) numbers.add(i);
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  let lastRendered = -1;
  const parts = sorted.map((n) => {
    const gap = lastRendered >= 0 && n - lastRendered > 1;
    lastRendered = n;
    const btn = `<button type="button" class="pager-num ${n === current ? 'is-active' : ''}" data-page="${n}"
      ${n === current ? 'aria-current="page"' : ''} aria-label="Page ${n + 1}">${n + 1}</button>`;
    return gap ? `<span class="pager-gap" aria-hidden="true">…</span>${btn}` : btn;
  });

  return `${infoLine}
    <button type="button" class="pager-num" data-page="${current - 1}" ${current === 0 ? 'disabled' : ''}
      aria-label="Previous page">${escapeHtml(prevLabel)}</button>
    ${parts.join('')}
    <button type="button" class="pager-num" data-page="${current + 1}" ${current >= last ? 'disabled' : ''}
      aria-label="Next page">${escapeHtml(nextLabel)}</button>`;
}

/** Delegated pager click handling for a `.pager` container. */
export function wirePager(pagerEl, onPage) {
  if (!pagerEl) return;
  pagerEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    if (isRepeatClick(btn, 250)) return;
    const page = Number(btn.dataset.page);
    if (!Number.isFinite(page) || page < 0) return;
    onPage(page);
  });
}

/** Very small, escape-first text formatter for streamed AI markdown-ish text. */
export function formatStreamText(raw) {
  const escaped = escapeHtml(raw || '');
  const lines = escaped.split('\n');
  const out = [];
  let inList = false;
  lines.forEach((line) => {
    const trimmed = line.trim();
    const listMatch = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (listMatch) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${applyInline(listMatch[1])}</li>`);
      return;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (/^#{1,6}\s+/.test(trimmed)) {
      out.push(`<h4>${applyInline(trimmed.replace(/^#{1,6}\s+/, ''))}</h4>`);
      return;
    }
    if (!trimmed) return;
    out.push(`<p>${applyInline(trimmed)}</p>`);
  });
  if (inList) out.push('</ul>');
  return out.join('');
}

function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

/* ---------------------------------------------------------------- toast */

let toastSeq = 0;

export function toast(message, options = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return () => {};
  const {
    type = 'info',
    title = '',
    duration,
    actionLabel = '',
    onAction = null,
    dismissible = true,
  } = options;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.dataset.toastId = String(++toastSeq);
  const iconName = type === 'success' ? 'checkCircle' : type === 'error' ? 'xCircle' : type === 'warn' ? 'alert' : 'info';
  el.innerHTML = `
    <span class="toast-icon">${icon(iconName)}</span>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
      <div class="toast-msg">${escapeHtml(message || '')}</div>
      ${actionLabel ? `<button type="button" class="toast-action" data-toast-action>${escapeHtml(actionLabel)}</button>` : ''}
    </div>
    ${dismissible ? '<button type="button" class="toast-close" data-toast-close aria-label="Dismiss notification">&times;</button>' : ''}
  `;

  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  };

  el.querySelector('[data-toast-close]')?.addEventListener('click', remove);
  const actionBtn = el.querySelector('[data-toast-action]');
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      try { if (onAction) onAction(); } finally { remove(); }
    });
  }
  host.appendChild(el);

  const ttl = duration !== undefined ? duration : (type === 'error' ? 6500 : 4200);
  if (ttl > 0) setTimeout(remove, ttl);
  return remove;
}

export const toastError = (message, options = {}) => toast(message, { ...options, type: 'error' });
export const toastSuccess = (message, options = {}) => toast(message, { ...options, type: 'success' });

/* --------------------------------------------------------------- dialog */

const dialogStack = [];

function focusables(root) {
  return Array.from(root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Generic modal.
 * @returns {{root: HTMLElement, bodyEl: HTMLElement, close: Function}}
 */
export function openModal({
  title = '',
  body = '',
  size = '',
  actions = [],
  onMount = null,
  locked = false,
} = {}) {
  const host = document.getElementById('dialog-host');
  if (!host) return { root: null, bodyEl: null, close: () => {} };

  const previousFocus = document.activeElement;
  host.hidden = false;

  const root = document.createElement('div');
  root.className = `dialog ${size === 'lg' ? 'dialog-lg' : ''}`.trim();
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const titleId = `dialog-title-${Date.now()}`;
  root.setAttribute('aria-labelledby', titleId);

  root.innerHTML = `
    <div class="dialog-head"><h2 id="${titleId}">${escapeHtml(title)}</h2></div>
    <div class="dialog-body"></div>
    <div class="dialog-foot"></div>
  `;

  const bodyEl = root.querySelector('.dialog-body');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body;

  const foot = root.querySelector('.dialog-foot');
  const api = { root, bodyEl, close: null };

  let closed = false;
  let onBackdrop = null;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    if (onBackdrop) host.removeEventListener('mousedown', onBackdrop);
    const idx = dialogStack.indexOf(entry);
    if (idx >= 0) dialogStack.splice(idx, 1);
    root.remove();
    if (!dialogStack.length) host.hidden = true;
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    if (entry.onClose) entry.onClose(result);
  };
  api.close = close;

  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-${action.variant || 'outline'}`;
    btn.textContent = action.label;
    if (action.testid) btn.dataset.testid = action.testid;
    btn.addEventListener('click', () => {
      const result = action.onClick ? action.onClick({ close, root, bodyEl }) : undefined;
      if (result === false) return;
      if (action.keepOpen !== true) close(result === undefined ? action.value : result);
    });
    foot.appendChild(btn);
  });

  const entry = { root, close, onClose: null };

  // Backdrop dismissal: the host's padding is the area outside the dialog.
  onBackdrop = (event) => {
    if (event.target === host && !locked) close(false);
  };
  host.addEventListener('mousedown', onBackdrop);

  const onKey = (event) => {
    if (dialogStack[dialogStack.length - 1] !== entry) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!locked) close(false);
      return;
    }
    if (event.key === 'Tab') {
      const items = focusables(root);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  host.appendChild(root);
  dialogStack.push(entry);
  document.addEventListener('keydown', onKey, true);

  if (onMount) onMount({ root, bodyEl, close, setOnClose: (fn) => { entry.onClose = fn; } });
  const auto = root.querySelector('[data-autofocus]') || focusables(root)[0];
  if (auto) setTimeout(() => auto.focus(), 0);

  return api;
}

export function confirmDialog({
  title = 'Please confirm',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  closeLabel = 'Close',
  tone = 'primary',
  bodyHtml = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const modal = openModal({
      title,
      body: `<p>${escapeHtml(message)}</p>${bodyHtml}`,
      actions: tone === 'none'
        ? [{ label: closeLabel, variant: 'primary', onClick: () => finish(true) }]
        : [
            { label: cancelLabel, variant: 'outline', onClick: () => finish(false) },
            { label: confirmLabel, variant: tone === 'danger' ? 'danger' : 'primary', onClick: () => finish(true) },
          ],
      // Esc / backdrop dismissal must settle the promise too.
      onMount: ({ root, setOnClose }) => {
        setOnClose(() => finish(false));
        root.querySelector('.dialog-foot .btn')?.setAttribute('data-autofocus', '');
      },
    });
    if (!modal.root) finish(false);
  });
}

export function alertDialog({ title = 'Notice', message = '', bodyHtml = '', closeLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(true); } };
    openModal({
      title,
      body: `<p>${escapeHtml(message)}</p>${bodyHtml}`,
      actions: [{ label: closeLabel, variant: 'primary', onClick: finish }],
      onMount: ({ setOnClose }) => setOnClose(finish),
    });
  });
}

export function closeTopDialog() {
  const entry = dialogStack[dialogStack.length - 1];
  if (entry) entry.close(false);
}

/* ------------------------------------------------------------ small misc */

export function el(tag, attrs = {}, html = '') {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  });
  if (html) node.innerHTML = html;
  return node;
}

export function qs(root, selector) { return root ? root.querySelector(selector) : null; }
export function qsa(root, selector) { return root ? Array.from(root.querySelectorAll(selector)) : []; }

export function formValues(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (data[key] === undefined) data[key] = value;
    else if (Array.isArray(data[key])) data[key].push(value);
    else data[key] = [data[key], value];
  });
  return data;
}

export function readInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

export function imageUrlOr(url, fallbackIndex = 0) {
  if (url && typeof url === 'string') return url;
  const n = ((fallbackIndex % 20) + 20) % 20 + 1;
  return `/assets/images/dish-${String(n).padStart(2, '0')}.jpg`;
}
