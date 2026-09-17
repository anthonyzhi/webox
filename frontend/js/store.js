/* store.js — tiny reactive store + localStorage persistence.
 * Holds auth, preferences, cart (client-side only) and shell UI state.
 * Deliberately does not import api.js so both directions stay cycle-free.
 */

import { confirmDialog, toast, formatCents } from './utils.js';

const KEYS = {
  token: 'webox.token',
  user: 'webox.user',
  expiresAt: 'webox.expiresAt',
  cart: 'webox.cart',
  prefs: 'webox.preferences',
  rules: 'webox.rules',
  lastAddress: 'webox.lastAddress',
};

export const DEFAULT_RULES = { maxQuantityPerOrder: 5, lunchCutoff: '10:00', dinnerCutoff: '15:00' };

const EMPTY_PREFS = {
  allergens: [],
  cuisinePreferences: [],
  spiceLevel: null,
  taste: null,
  budgetMinCents: null,
  budgetMaxCents: null,
  recommendEnabled: false,
};

const listeners = new Set();

export const state = {
  token: null,
  user: null,
  expiresAt: null,
  preferences: { ...EMPTY_PREFS },
  rules: { ...DEFAULT_RULES },
  cart: [],
  cartOpen: false,
  aiOpen: false,
  bootstrapped: false,
  route: { path: '/menu', params: {} },
};

/* ------------------------------------------------------- core reactivity */

export function getState() { return state; }

export function setState(patch) {
  Object.keys(patch).forEach((key) => { state[key] = patch[key]; });
  listeners.forEach((fn) => {
    try { fn(state, patch); } catch (err) { console.error('[store] subscriber failed', err); }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------ persistence */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (err) { /* storage full / disabled — the app still works in-memory */ }
}

export function hydrateFromStorage() {
  const token = localStorage.getItem(KEYS.token) || null;
  const user = readJSON(KEYS.user, null);
  const cart = readJSON(KEYS.cart, []);
  const preferences = readJSON(KEYS.prefs, null);
  const rules = readJSON(KEYS.rules, null);
  state.token = token;
  state.user = user && typeof user === 'object' ? user : null;
  state.cart = Array.isArray(cart) ? cart.filter(isCartLine).map(normalizeLine) : [];
  state.preferences = preferences ? { ...EMPTY_PREFS, ...preferences } : { ...EMPTY_PREFS };
  state.rules = { ...DEFAULT_RULES, ...(rules || {}) };
  state.expiresAt = localStorage.getItem(KEYS.expiresAt) || null;
}

/* ------------------------------------------------------------------ auth */

export function getToken() { return state.token; }
export function getUser() { return state.user; }
export function isAuthenticated() { return Boolean(state.token && state.user); }
export function isAdmin() { return state.user?.role === 'ADMIN'; }
export function roleHome(role = state.user?.role) {
  return role === 'ADMIN' ? '#/console/dashboard' : '#/menu';
}

export function setAuth({ token, user, expiresAt }) {
  state.token = token || null;
  state.user = user || null;
  state.expiresAt = expiresAt || null;
  if (token) localStorage.setItem(KEYS.token, token);
  else localStorage.removeItem(KEYS.token);
  writeJSON(KEYS.user, user || null);
  if (expiresAt) localStorage.setItem(KEYS.expiresAt, expiresAt);
  else localStorage.removeItem(KEYS.expiresAt);
  setState({ token: state.token, user: state.user, expiresAt: state.expiresAt });
}

export function clearAuth() {
  state.token = null;
  state.user = null;
  state.expiresAt = null;
  state.cart = [];
  localStorage.removeItem(KEYS.token);
  localStorage.removeItem(KEYS.user);
  localStorage.removeItem(KEYS.expiresAt);
  writeJSON(KEYS.cart, null);
  setState({ token: null, user: null, expiresAt: null, cart: state.cart });
}

export function setUser(user) {
  state.user = user || null;
  writeJSON(KEYS.user, state.user);
  setState({ user: state.user });
}

export function setPreferences(preferences) {
  state.preferences = { ...EMPTY_PREFS, ...(preferences || {}) };
  writeJSON(KEYS.prefs, state.preferences);
  setState({ preferences: state.preferences });
}

export function getPreferences() { return state.preferences; }
export function flaggedAllergens() { return state.preferences.allergens || []; }

export function setRules(rules) {
  if (!rules) return;
  const merged = { ...state.rules, ...rules };
  state.rules = merged;
  writeJSON(KEYS.rules, { maxQuantityPerOrder: merged.maxQuantityPerOrder });
  setState({ rules: merged });
}

export function maxQuantityPerOrder() {
  const n = Number(state.rules?.maxQuantityPerOrder);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export function getLastAddress() { return localStorage.getItem(KEYS.lastAddress) || ''; }
export function setLastAddress(address) {
  if (address) localStorage.setItem(KEYS.lastAddress, address);
}

/* ------------------------------------------------------------------ shell */

export function openCart() { setState({ cartOpen: true }); }
export function closeCart() { setState({ cartOpen: false }); }
export function openAiPanel() { setState({ aiOpen: true }); }
export function closeAiPanel() { setState({ aiOpen: false }); }

/* ------------------------------------------------------------------- cart */

/** A cart line is unique per dish + exact option set. */
export function lineKey(menuId, optionIds = []) {
  const ids = [...optionIds].map((n) => Number(n)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  return `${menuId}#${ids.join('-')}`;
}

function isCartLine(line) {
  return line && typeof line === 'object' && Number.isFinite(Number(line.menuId)) && Number.isFinite(Number(line.quantity));
}

/** Remaining stock as a number, or null when the server did not tell us. */
export function toRemaining(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLine(line) {
  return {
    key: line.key || lineKey(line.menuId, line.optionIds || []),
    menuId: Number(line.menuId),
    dishId: line.dishId ?? null,
    name: String(line.name || 'Dish'),
    imageUrl: line.imageUrl || '',
    category: line.category || '',
    allergens: Array.isArray(line.allergens) ? line.allergens : [],
    basePriceCents: Math.round(Number(line.basePriceCents) || 0),
    optionsPriceCents: Math.round(Number(line.optionsPriceCents) || 0),
    unitPriceCents: Math.round(Number(line.unitPriceCents) || (Number(line.basePriceCents) || 0) + (Number(line.optionsPriceCents) || 0)),
    optionIds: Array.isArray(line.optionIds) ? line.optionIds.map(Number) : [],
    optionText: line.optionText || '',
    quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
    remaining: toRemaining(line.remaining),
    soldOut: Boolean(line.soldOut),
    hasOptions: Boolean(line.hasOptions),
  };
}

function persistCart() {
  writeJSON(KEYS.cart, state.cart);
}

export function getCart() { return state.cart; }

export function cartServings(cart = state.cart) {
  return cart.reduce((acc, line) => acc + (Number(line.quantity) || 0), 0);
}

export function cartTotalCents(cart = state.cart) {
  return cart.reduce((acc, line) => acc + Math.round(Number(line.unitPriceCents) || 0) * (Number(line.quantity) || 0), 0);
}

export function cartRemainingServings() {
  return Math.max(0, maxQuantityPerOrder() - cartServings());
}

export function findLine(key) { return state.cart.find((line) => line.key === key) || null; }

export function lineMaxQuantity(line) {
  const cap = maxQuantityPerOrder() - (cartServings() - line.quantity);
  const stockCap = Number.isFinite(line.remaining) ? line.remaining : cap;
  return Math.max(0, Math.min(cap, stockCap));
}

export function lineLimitReason(line) {
  const othersServings = cartServings() - line.quantity;
  const perOrder = maxQuantityPerOrder() - othersServings;
  if (line.soldOut) return 'This dish is sold out.';
  if (Number.isFinite(line.remaining) && line.remaining <= 0) return 'This dish is sold out.';
  if (Number.isFinite(line.remaining) && line.remaining <= line.quantity) return `Only ${line.remaining} left in stock.`;
  if (perOrder <= line.quantity) return `Only ${maxQuantityPerOrder()} servings per order.`;
  return '';
}

/**
 * Add to cart. Returns { ok, reason, line }.
 * Enforces the per-order servings cap and known stock, in integer cents.
 */
export function addToCart(line, quantity = 1) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const candidate = normalizeLine({ ...line, quantity: qty });
  const existing = findLine(candidate.key);
  const max = maxQuantityPerOrder();
  const already = cartServings();
  const currentQty = existing ? existing.quantity : 0;
  const capacity = max - already;
  const added = Math.min(qty, capacity);

  if (added <= 0) {
    return { ok: false, reason: `Only ${max} servings per order.`, code: 'MAX_SERVINGS' };
  }
  if (candidate.remaining !== null && candidate.remaining <= currentQty) {
    return { ok: false, reason: candidate.remaining <= 0 ? 'This dish is sold out.' : `Only ${candidate.remaining} left in stock.`, code: 'INSUFFICIENT_STOCK' };
  }

  if (existing) {
    existing.quantity = currentQty + added;
    if (candidate.remaining !== null) existing.remaining = candidate.remaining;
    existing.soldOut = candidate.soldOut;
    existing.unitPriceCents = candidate.unitPriceCents;
    existing.optionText = candidate.optionText || existing.optionText;
  } else {
    candidate.quantity = added;
    state.cart = [...state.cart, candidate];
  }
  persistCart();
  setState({ cart: state.cart });
  return { ok: true, line: findLine(candidate.key) };
}

export function setLineQuantity(key, quantity) {
  const line = findLine(key);
  if (!line) return { ok: false, reason: 'This item is no longer in your cart.' };
  const qty = Math.round(Number(quantity) || 0);
  if (qty <= 0) return removeLine(key);
  const max = lineMaxQuantity(line);
  if (qty > max) {
    return { ok: false, reason: lineLimitReason(line) || `Only ${maxQuantityPerOrder()} servings per order.` };
  }
  line.quantity = qty;
  persistCart();
  setState({ cart: state.cart });
  return { ok: true };
}

export function increaseLine(key) {
  const line = findLine(key);
  if (!line) return { ok: false, reason: 'This item is no longer in your cart.' };
  return setLineQuantity(key, line.quantity + 1);
}

export function decreaseLine(key) {
  const line = findLine(key);
  if (!line) return { ok: false, reason: 'This item is no longer in your cart.' };
  return setLineQuantity(key, line.quantity - 1);
}

export function removeLine(key) {
  state.cart = state.cart.filter((line) => line.key !== key);
  persistCart();
  setState({ cart: state.cart });
  return { ok: true };
}

export function clearCart() {
  state.cart = [];
  persistCart();
  setState({ cart: state.cart });
}

/** Apply realtime stock snapshots to cart lines so the + button reflects reality. */
export function applyStockToCart(items) {
  if (!Array.isArray(items) || !items.length) return false;
  const byMenuId = new Map(items.map((it) => [Number(it.menuId), it]));
  let changed = false;
  state.cart.forEach((line) => {
    const update = byMenuId.get(line.menuId);
    if (!update) return;
    const remaining = toRemaining(update.remaining);
    const soldOut = Boolean(update.soldOut) || (remaining !== null && remaining <= 0);
    if (line.remaining !== remaining || line.soldOut !== soldOut) {
      if (remaining !== null) line.remaining = remaining;
      line.soldOut = soldOut;
      changed = true;
    }
    if (soldOut && remaining !== null && line.quantity > remaining) line.quantity = Math.max(0, remaining);
  });
  if (changed) {
    state.cart = state.cart.filter((line) => line.quantity > 0);
    persistCart();
    setState({ cart: state.cart });
  }
  return changed;
}

export function cartPayload() {
  return state.cart.map((line) => ({ menuId: line.menuId, quantity: line.quantity, optionIds: line.optionIds || [] }));
}

/* ------------------------------------------------------ allergen + add flow */

/**
 * Single entry point used by the menu page, dish detail and the AI panel:
 * checks flagged allergens, asks for confirmation, then mutates the cart once.
 */
export async function addToCartFlow(item, { quantity = 1, options = [], skipAllergenCheck = false } = {}) {
  const flagged = flaggedAllergens();
  const dishAllergens = Array.isArray(item.allergens) ? item.allergens : [];
  const conflicts = dishAllergens.filter((a) => flagged.includes(a));

  if (conflicts.length && !skipAllergenCheck) {
    const ok = await confirmDialog({
      title: 'Allergen warning',
      message: `This dish contains an allergen you flagged: ${conflicts.join(', ')}. Add anyway?`,
      confirmLabel: 'Add anyway',
      cancelLabel: 'Cancel',
    });
    if (!ok) return { ok: false, reason: 'cancelled', code: 'ALLERGEN_CANCELLED' };
  }

  const optionsPriceCents = options.reduce((acc, opt) => acc + Math.round(Number(opt.extraPriceCents) || 0), 0);
  const basePriceCents = Math.round(Number(item.priceCents) || 0);
  const optionIds = options.map((opt) => Number(opt.id)).filter((n) => Number.isFinite(n));
  const optionNameOf = (opt) => {
    const name = opt.name || opt.optionName || '';
    const extra = Math.round(Number(opt.extraPriceCents) || 0);
    return extra > 0 ? `${name} +${formatCents(extra)}` : name;
  };

  const line = {
    menuId: Number(item.menuId),
    dishId: item.dishId ?? null,
    name: item.name || 'Dish',
    imageUrl: item.imageUrl || '',
    category: item.category || '',
    allergens: dishAllergens,
    basePriceCents,
    optionsPriceCents,
    unitPriceCents: basePriceCents + optionsPriceCents,
    optionIds,
    optionText: options.map(optionNameOf).join(' · '),
    remaining: toRemaining(item.remaining),
    soldOut: Boolean(item.soldOut),
    hasOptions: Boolean(item.hasOptions ?? (Array.isArray(item.optionGroups) && item.optionGroups.some((g) => (g.options || []).length))),
  };

  const result = addToCart(line, quantity);
  if (!result.ok) toast(result.reason, { type: 'warn' });
  return result;
}

export function dishHasOptions(item) {
  return Array.isArray(item?.optionGroups) && item.optionGroups.some((g) => (g.options || []).length > 0);
}
