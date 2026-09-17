/* pages/checkout.js — cart summary, delivery slot with auto-switch, idempotent submit. */

import { api, ApiError, createIdempotencyKey, isAbort } from '../api.js';
import {
  getState, getCart, cartTotalCents, cartServings, cartPayload, clearCart, setRules,
  maxQuantityPerOrder, getPreferences, getLastAddress, setLastAddress,
  increaseLine, decreaseLine, lineLimitReason, openCart, closeCart, subscribe,
} from '../store.js';
import {
  LIMITS, escapeHtml, formatCents, icon, isRepeatClick, mealPeriodLabel, dayLabel, formatDate,
  todayStr, spinnerHtml, errorStateHtml, emptyStateHtml, toast, toastSuccess, setBusy,
  validateAddress, setFieldError, clearFieldErrors, imageUrlOr, truncate,
} from '../utils.js';
import { navigate } from '../router.js';

const s = {
  loading: true,
  error: null,
  deliveryDate: todayStr(),
  mealPeriod: 'LUNCH',
  context: null,
  addresses: [],
  newAddressMode: false,
  draftAddress: '',
  banner: null,
  slotNotice: null,
  stockError: null,
  submitError: null,
  placing: false,
  idemKey: null,
  replayed: false,
  autoSwitched: false,
  requestedSlot: null,
  signature: '',
  success: null,
  successTotalCents: 0,
  existingOrderId: null,
  existingOrderNo: null,
};

let dom = {};
let unsubscribeCart = null;
let contextsInFlight = 0;

export async function renderCheckoutPage(root) {
  closeCart();
  if (!getCart().length) {
    root.innerHTML = `<section class="page">
      <h1>Checkout</h1>
      ${emptyStateHtml({
        title: 'Your cart is empty',
        message: 'Add a dish from today’s menu to start an order.',
        actionLabel: 'Browse the menu',
        actionAttrs: 'data-go-menu',
        iconName: 'cart',
      })}
    </section>`;
    root.querySelector('[data-go-menu]')?.addEventListener('click', () => navigate('/menu'));
    return () => {};
  }

  root.innerHTML = `<section class="page">
    <header class="page-head">
      <div>
        <h1>Checkout</h1>
        <p class="page-sub">Confirm your delivery slot and address, then place your order.</p>
      </div>
      <div class="page-head-actions">
        <button type="button" class="btn btn-ghost" data-open-cart>${icon('cart')}<span>Edit cart</span></button>
      </div>
    </header>
    <div data-role="body">${spinnerHtml('Loading checkout…')}</div>
  </section>`;

  dom = { body: root.querySelector('[data-role="body"]') };
  root.querySelector('[data-open-cart]').addEventListener('click', openCart);
  unsubscribeCart = subscribe(() => {
    if (s.success) return;
    if (!getCart().length) {
      navigate('/menu');
      return;
    }
    if (!dom.summary) return;
    renderSummary();
  });

  await loadInitial();
  return () => { if (unsubscribeCart) unsubscribeCart(); dom = {}; };
}

/* ------------------------------------------------------------------- data */

async function loadInitial() {
  s.loading = true;
  s.error = null;
  try {
    const [addresses, context] = await Promise.all([
      api.get('/me/addresses').catch(() => []),
      api.get('/orders/context'),
    ]);
    s.addresses = Array.isArray(addresses) ? addresses : [];
    applyContext(context, { initial: true });

    const last = getLastAddress();
    const known = s.addresses.map((a) => a.address);
    if (last && !known.includes(last)) {
      s.addresses = [{ id: 'local', address: last, lastUsedAt: null }, ...s.addresses];
    }
    s.draftAddress = last || (s.addresses[0] ? s.addresses[0].address : '');
    s.newAddressMode = !s.addresses.length;

    s.loading = false;
    renderForm();
    await refreshContext();
  } catch (err) {
    if (isAbort(err)) return;
    s.loading = false;
    dom.body.innerHTML = errorStateHtml({
      title: 'Checkout unavailable',
      message: err?.message || 'Could not load your checkout details.',
      retryAttrs: 'data-retry-checkout',
    });
    dom.body.querySelector('[data-retry-checkout]')?.addEventListener('click', () => loadInitial());
  }
}

function applyContext(context, { initial = false } = {}) {
  if (!context) return;
  s.context = context;
  if (context.rules) setRules(context.rules);
  const next = context.nextSlot;
  if (initial && next) {
    if (next.deliveryDate) s.deliveryDate = next.deliveryDate;
    if (next.mealPeriod) s.mealPeriod = next.mealPeriod;
  }
  applyExistingOrder(context);
}

/**
 * One active order per meal slot: when the server reports one for the selected slot, the primary
 * action becomes "View existing order" instead of submitting a second order.
 */
function applyExistingOrder(context) {
  const active = context?.existingActiveOrder;
  s.existingOrderId = active?.orderId ?? null;
  s.existingOrderNo = active?.orderNo ?? null;
}

async function refreshContext({ requested = null } = {}) {
  const requestedSlot = requested || { deliveryDate: s.deliveryDate, mealPeriod: s.mealPeriod };
  const token = ++contextsInFlight;
  try {
    const context = await api.get('/orders/context', { query: requestedSlot });
    if (token !== contextsInFlight) return;
    s.context = context;
    if (context.rules) setRules(context.rules);

    if (context.autoSwitched && context.nextSlot) {
      s.deliveryDate = context.nextSlot.deliveryDate || s.deliveryDate;
      s.mealPeriod = context.nextSlot.mealPeriod || s.mealPeriod;
      s.banner = `${mealPeriodLabel(requestedSlot.mealPeriod)} ordering closed at ${cutoffFor(requestedSlot.mealPeriod, context)} — switched to ${context.nextSlot.label || `${dayLabel(s.deliveryDate)} ${mealPeriodLabel(s.mealPeriod)}`}.`;
      // Validate the switched slot without re-entering the auto-switch branch.
      const confirmed = await api.get('/orders/context', {
        query: { deliveryDate: s.deliveryDate, mealPeriod: s.mealPeriod },
      });
      s.context = confirmed;
      if (confirmed.rules) setRules(confirmed.rules);
      applyExistingOrder(confirmed);
    } else {
      s.banner = null;
      applyExistingOrder(context);
    }
    s.slotNotice = null;
    syncForm();
  } catch (err) {
    if (isAbort(err)) return;
    toast(err?.message || 'Could not check the delivery slot.', { type: 'warn' });
  }
}

function cutoffFor(meal, context = s.context) {
  const rules = context?.rules || getState().rules || {};
  if (meal === 'DINNER') return rules.dinnerCutoff || '15:00';
  return rules.lunchCutoff || '10:00';
}

/* -------------------------------------------------------------- rendering */

function renderForm() {
  const prefs = getPreferences();
  dom.body.innerHTML = `
    <div class="checkout-layout">
      <div class="stack">
        <div class="card card-pad">
          <h2>Delivery slot</h2>
          <div class="grid-2">
            <div class="field">
              <label class="label" for="co-date">Delivery date <span class="req-star">*</span></label>
              <input class="input" id="co-date" name="deliveryDate" type="date" value="${escapeHtml(s.deliveryDate)}"
                     min="${escapeHtml(todayStr())}">
              <p class="field-error" data-error-for="deliveryDate"></p>
            </div>
            <div class="field">
              <span class="label">Meal period <span class="req-star">*</span></span>
              <div class="radio-row" role="radiogroup" aria-label="Meal period">
                <label class="radio-card" data-meal-card="LUNCH">
                  <input type="radio" name="mealPeriod" value="LUNCH"> <span>Lunch</span>
                </label>
                <label class="radio-card" data-meal-card="DINNER">
                  <input type="radio" name="mealPeriod" value="DINNER"> <span>Dinner</span>
                </label>
              </div>
              <p class="field-error" data-error-for="mealPeriod"></p>
            </div>
          </div>
          <div data-role="slot-info"></div>
        </div>

        <div class="card card-pad">
          <h2>Delivery address</h2>
          <div class="field">
            <label class="label" for="co-address">Saved addresses</label>
            <span class="select-wrap">
              <select class="select" id="co-address" name="savedAddress">
                <option value="">Select an address…</option>
                ${s.addresses.map((a) => `<option value="${escapeHtml(a.address)}">${escapeHtml(truncate(a.address, 80))}</option>`).join('')}
                <option value="__new">+ New address</option>
              </select>
            </span>
          </div>
          <div class="field">
            <label class="label" for="co-new-address">Delivery address <span class="req-star">*</span></label>
            <input class="input" id="co-new-address" name="address" type="text" maxlength="${LIMITS.address}"
                   autocomplete="street-address" placeholder="Building A, Floor 3, Desk 12">
            <p class="help">Up to ${LIMITS.address} characters. New addresses are remembered after your order.</p>
            <p class="field-error" data-error-for="address"></p>
          </div>
        </div>
      </div>

      <aside class="checkout-aside stack">
        <div class="card">
          <div class="card-head"><h2>Order summary</h2><span class="badge badge-neutral" data-role="servings"></span></div>
          <div class="card-body stack-sm" data-role="lines"></div>
          <div class="card-foot" data-role="summary"></div>
        </div>
        <div data-role="alerts"></div>
        ${prefs.budgetMaxCents ? `<p class="help">Per-meal budget: ${escapeHtml(formatCents(prefs.budgetMaxCents))}</p>` : ''}
      </aside>
    </div>`;

  dom.date = dom.body.querySelector('#co-date');
  dom.mealCards = Array.from(dom.body.querySelectorAll('[data-meal-card]'));
  dom.addressSelect = dom.body.querySelector('#co-address');
  dom.addressInput = dom.body.querySelector('#co-new-address');
  dom.lines = dom.body.querySelector('[data-role="lines"]');
  dom.summary = dom.body.querySelector('[data-role="summary"]');
  dom.alerts = dom.body.querySelector('[data-role="alerts"]');
  dom.slotInfo = dom.body.querySelector('[data-role="slot-info"]');
  dom.servings = dom.body.querySelector('[data-role="servings"]');

  dom.date.addEventListener('change', () => {
    s.deliveryDate = dom.date.value || todayStr();
    s.existingOrderId = null;
    invalidateAttempt();
    refreshContext();
  });

  dom.mealCards.forEach((card) => {
    card.querySelector('input').addEventListener('change', (event) => {
      if (!event.target.checked) return;
      s.mealPeriod = event.target.value;
      s.existingOrderId = null;
      invalidateAttempt();
      refreshContext();
    });
  });

  dom.addressSelect.addEventListener('change', () => {
    const value = dom.addressSelect.value;
    if (value === '__new') {
      s.newAddressMode = true;
      s.draftAddress = '';
      invalidateAttempt();
      syncForm();
      dom.addressInput.focus();
      return;
    }
    s.newAddressMode = value === '';
    s.draftAddress = value;
    invalidateAttempt();
    syncForm();
  });

  dom.addressInput.addEventListener('input', () => {
    s.draftAddress = dom.addressInput.value;
    invalidateAttempt();
    if (dom.addressInput.getAttribute('aria-invalid') === 'true') setFieldError(dom.body, 'address', '');
    renderSummary();
  });

  syncForm();
}

function syncForm() {
  if (!dom.date) return;
  dom.date.value = s.deliveryDate;
  dom.date.min = todayStr();
  dom.mealCards.forEach((card) => {
    const input = card.querySelector('input');
    input.checked = input.value === s.mealPeriod;
    card.classList.toggle('is-checked', input.checked);
  });

  if (s.newAddressMode) {
    dom.addressSelect.value = '__new';
  } else if (hasOption(dom.addressSelect, s.draftAddress)) {
    dom.addressSelect.value = s.draftAddress;
  }
  dom.addressInput.value = s.draftAddress;

  if (dom.slotInfo) {
    const next = s.context?.nextSlot;
    const parts = [];
    parts.push(`<p class="help">Lunch orders close at <strong>${escapeHtml(cutoffFor('LUNCH'))}</strong>, dinner orders at <strong>${escapeHtml(cutoffFor('DINNER'))}</strong>.</p>`);
    if (next?.label) parts.push(`<p class="help">Next bookable slot: <strong>${escapeHtml(next.label)}</strong>${next.cutoffAt ? ` (cut-off ${escapeHtml(next.cutoffAt.slice(11, 16))})` : ''}.</p>`);
    if (s.context && s.context.requestedSlotBookable === false && !s.banner) {
      parts.push(`<div class="notice notice-warn">${icon('clockOff')}<span>That slot is closed. The nearest bookable slot is <strong>${escapeHtml(next?.label || 'the next available slot')}</strong>.</span></div>`);
    }
    dom.slotInfo.innerHTML = parts.join('');
  }

  renderSummary();
  renderAlerts();
}

function renderSummary() {
  if (!dom.lines) return;
  const cart = getCart();
  const max = maxQuantityPerOrder();
  const servings = cartServings();

  dom.servings.textContent = `${servings} of ${max} servings`;

  dom.lines.innerHTML = cart.map((line) => `<div class="cart-line" data-line="${escapeHtml(line.key)}">
    <img class="cart-line-media" src="${escapeHtml(imageUrlOr(line.imageUrl))}" alt="" loading="lazy" width="62" height="62">
    <div class="cart-line-body">
      <span class="cart-line-name">${escapeHtml(line.name)}</span>
      ${line.optionText ? `<span class="cart-line-opts">${escapeHtml(line.optionText)}</span>` : ''}
      <span class="cart-line-actions">
        <span class="qty">
          <button type="button" class="qty-btn" data-dec aria-label="Remove one serving of ${escapeHtml(line.name)}">−</button>
          <span class="qty-value">${line.quantity}</span>
          <button type="button" class="qty-btn" data-inc aria-label="Add one serving of ${escapeHtml(line.name)}"
            ${servings >= max || (Number.isFinite(line.remaining) && line.quantity >= line.remaining) ? 'disabled' : ''}
            title="${escapeHtml(lineLimitReason(line) || 'Add one serving')}">+</button>
        </span>
        <span class="line-total">${escapeHtml(formatCents(line.unitPriceCents * line.quantity))}</span>
      </span>
      <span class="tiny muted">${escapeHtml(formatCents(line.unitPriceCents))} each</span>
    </div>
  </div>`).join('');

  dom.lines.querySelectorAll('[data-line]').forEach((row) => {
    const key = row.dataset.line;
    row.querySelector('[data-dec]')?.addEventListener('click', (event) => {
      if (isRepeatClick(event.currentTarget, 250)) return;
      const res = decreaseLine(key);
      if (!res.ok) toast(res.reason, { type: 'warn' });
    });
    row.querySelector('[data-inc]')?.addEventListener('click', (event) => {
      if (isRepeatClick(event.currentTarget, 250)) return;
      const res = increaseLine(key);
      if (!res.ok) toast(res.reason, { type: 'warn' });
    });
  });

  const total = cartTotalCents();
  const prefs = getPreferences();
  const overBudget = prefs.budgetMaxCents && total > prefs.budgetMaxCents;
  const viewing = Boolean(s.existingOrderId);

  dom.summary.innerHTML = `
    <div class="kv"><dt>Items</dt><dd>${servings}</dd></div>
    <div class="kv"><dt>Delivery</dt><dd>Free</dd></div>
    <div class="kv kv-total"><dt>Total</dt><dd>${escapeHtml(formatCents(total))}</dd></div>
    <button type="button" class="btn ${viewing ? 'btn-outline' : 'btn-primary'} btn-lg btn-block mt-2"
      data-place data-view-existing="${viewing ? '1' : '0'}">${viewing ? 'View existing order' : 'Place order'}</button>
    <p class="help center mt-2">${escapeHtml(dayLabel(s.deliveryDate))} · ${escapeHtml(mealPeriodLabel(s.mealPeriod))}</p>`;

  const placeBtn = dom.summary.querySelector('[data-place]');
  placeBtn.disabled = !viewing && (s.placing || servings === 0);
  placeBtn.addEventListener('click', () => {
    if (isRepeatClick(placeBtn, 400)) return;
    if (s.existingOrderId) {
      navigate(`/orders/${encodeURIComponent(s.existingOrderId)}`);
      return;
    }
    placeOrder();
  });
  if (overBudget && !viewing) {
    placeBtn.title = `Above your per-meal budget of ${formatCents(prefs.budgetMaxCents)}`;
  }
  syncAlerts();
}

function renderAlerts() {
  if (!dom.alerts) return;
  const alerts = [];
  if (s.banner) {
    alerts.push(`<div class="notice" role="status">${icon('info')}<span>${escapeHtml(s.banner)}</span></div>`);
  }
  if (s.slotNotice) {
    alerts.push(`<div class="notice notice-warn" role="status">${icon('alert')}<span>${escapeHtml(s.slotNotice)}</span></div>`);
  }
  const active = s.context?.existingActiveOrder;
  if (active) {
    alerts.push(`<div class="notice notice-warn" role="status">${icon('alert')}<span>
      You already have an active order for this slot (${escapeHtml(active.orderNo || `#${active.id}`)}).
      <br><a href="#/orders/${encodeURIComponent(active.id)}">View that order</a></span></div>`);
  }
  if (s.stockError?.length) {
    alerts.push(`<div class="notice notice-danger" role="alert">${icon('alert')}<span>
      <strong>Stock changed while you were ordering.</strong>
      <ul>${s.stockError.map((it) => `<li>${escapeHtml(it.dishName || `Dish ${it.menuId}`)}: requested ${escapeHtml(it.requested)}, only ${escapeHtml(it.remaining)} left.</li>`).join('')}</ul>
      Adjust the quantities in your cart and try again.</span></div>`);
  }
  if (s.submitError) {
    alerts.push(`<div class="notice notice-danger" role="alert">${icon('alert')}<span>${escapeHtml(s.submitError)}</span></div>`);
  }
  dom.alerts.innerHTML = alerts.join('');
  syncAlerts();
}

function syncAlerts() {
  const placeBtn = dom.summary?.querySelector('[data-place]');
  if (!placeBtn) return;
  const prefs = getPreferences();
  const total = cartTotalCents();
  const overBudget = Boolean(prefs.budgetMaxCents && total > prefs.budgetMaxCents);
  const extra = dom.alerts?.querySelector('[data-budget-warning]');
  if (overBudget && !extra) {
    dom.alerts.insertAdjacentHTML('afterbegin', `<div class="notice notice-warn" data-budget-warning role="status">
      ${icon('alert')}<span>This order is above your per-meal budget of ${escapeHtml(formatCents(prefs.budgetMaxCents))}.</span></div>`);
  } else if (!overBudget && extra) {
    extra.remove();
  }
}

/* ------------------------------------------------------------------ submit */

function currentAddress() {
  return (s.draftAddress || '').trim();
}

function signature() {
  return JSON.stringify({
    d: s.deliveryDate,
    m: s.mealPeriod,
    a: currentAddress(),
    i: cartPayload(),
  });
}

function invalidateAttempt() {
  const sig = signature();
  if (sig !== s.signature) {
    s.signature = sig;
    s.idemKey = null;
    s.stockError = null;
    s.submitError = null;
  }
}

async function placeOrder() {
  if (s.placing || s.success) return;
  clearFieldErrors(dom.body);
  s.stockError = null;
  s.submitError = null;

  const address = currentAddress();
  const addressError = validateAddress(address);
  if (addressError) {
    setFieldError(dom.body, 'address', addressError);
    if (!s.newAddressMode) {
      s.newAddressMode = true;
      syncForm();
      setFieldError(dom.body, 'address', addressError);
    }
    toast(addressError, { type: 'warn' });
    renderAlerts();
    return;
  }

  invalidateAttempt();
  if (!s.idemKey) s.idemKey = createIdempotencyKey();

  s.placing = true;
  const placeBtn = dom.summary.querySelector('[data-place]');
  setBusy(placeBtn, true, 'Placing…');
  renderAlerts();

  const payload = {
    deliveryDate: s.deliveryDate,
    mealPeriod: s.mealPeriod,
    address,
    items: cartPayload(),
  };

  try {
    // The API answers with { order, replayed, requestedDeliveryDate, requestedMealPeriod }.
    // A replay (same idempotency key) returns the original order, which is exactly what the
    // success screen should show — the employee never ends up with two orders.
    const response = await api.post('/orders', payload, {
      headers: { 'Idempotency-Key': s.idemKey },
    });
    s.success = response?.order || {};
    s.replayed = Boolean(response?.replayed);
    // The server books the nearest open slot when the requested one has closed; comparing the
    // requested slot with the booked one is how the confirmation explains the change.
    const requested = response?.requestedDeliveryDate && response?.requestedMealPeriod
      ? { deliveryDate: response.requestedDeliveryDate, mealPeriod: response.requestedMealPeriod }
      : null;
    s.requestedSlot = requested;
    s.autoSwitched = Boolean(requested && (requested.deliveryDate !== s.success.deliveryDate
      || requested.mealPeriod !== s.success.mealPeriod));
    s.successTotalCents = Number.isFinite(Number(s.success.totalCents))
      ? Number(s.success.totalCents)
      : cartTotalCents();
    s.placing = false;
    clearCart();
    setLastAddress(address);
    renderSuccess();
  } catch (err) {
    s.placing = false;
    setBusy(placeBtn, false);
    handleSubmitError(err, payload);
  }
}

function handleSubmitError(err, payload) {
  if (!(err instanceof ApiError)) {
    s.submitError = 'Unexpected error. Please try again.';
    renderAlerts();
    return;
  }
  const label = `${mealPeriodLabel(payload.mealPeriod)} · ${dayLabel(payload.deliveryDate)}`;

  switch (err.code) {
    case 'ACTIVE_ORDER_EXISTS': {
      const orderId = err.details?.orderId;
      s.submitError = null;
      s.existingOrderId = orderId ?? s.existingOrderId;
      renderSummary();
      renderAlerts();
      toast(err.message || 'You already have an active order for this slot.', { type: 'warn', title: 'Active order' });
      if (orderId) {
        // Let the button visibly flip to "View existing order" before navigating.
        window.setTimeout(() => navigate(`/orders/${encodeURIComponent(orderId)}`), 900);
      }
      break;
    }
    case 'INSUFFICIENT_STOCK': {
      const items = Array.isArray(err.details?.items) ? err.details.items : [];
      s.stockError = items.length ? items : null;
      s.submitError = items.length ? null : (err.message || 'Some dishes no longer have enough stock.');
      renderAlerts();
      toast(err.message || 'Not enough stock for some dishes.', { type: 'error', title: 'Stock shortfall' });
      break;
    }
    case 'MAX_QUANTITY_EXCEEDED': {
      s.submitError = err.message
        || `You can order at most ${maxQuantityPerOrder()} servings per order.`;
      renderAlerts();
      toast(s.submitError, { type: 'error' });
      break;
    }
    case 'VALIDATION_ERROR': {
      if (err.fieldErrors) {
        Object.entries(err.fieldErrors).forEach(([field, message]) => setFieldError(dom.body, field, message));
      }
      s.submitError = err.message || 'Please fix the highlighted fields.';
      renderAlerts();
      break;
    }
    case 'MENU_CLOSED':
    case 'MENU_ITEM_NOT_FOUND': {
      s.submitError = `${err.message || 'A dish is no longer available.'} Remove it from your cart or pick another dish.`;
      renderAlerts();
      toast(s.submitError, { type: 'error' });
      break;
    }
    case 'NETWORK_ERROR': {
      s.submitError = `${err.message} Your cart is unchanged — press “Place order” again to retry safely.`;
      renderAlerts();
      break;
    }
    default: {
      s.submitError = err.message || 'Could not place the order. Please try again.';
      renderAlerts();
      toast(err.message || 'Could not place the order.', { type: 'error' });
    }
  }
  if (!s.submitError && s.stockError) {
    toast(`Some dishes changed for ${label}.`, { type: 'warn' });
  }
}

/* ------------------------------------------------------------- success view */

function renderSuccess() {
  const order = s.success || {};
  const deliveryDate = order.deliveryDate || s.deliveryDate;
  const mealPeriod = order.mealPeriod || s.mealPeriod;
  const totalCents = Number.isFinite(Number(order.totalCents)) ? Number(order.totalCents) : s.successTotalCents;
  const address = order.address || currentAddress();
  const quantity = Number(order.totalQuantity) || 0;
  const adjustedFrom = s.autoSwitched ? s.requestedSlot : null;
  const orderId = order.id ?? order.orderId;

  dom.body.innerHTML = `<div class="checkout-layout">
    <div class="stack">
      <div class="card card-pad">
        <div class="center">
          <span class="brand-mark" style="margin:0 auto 12px" aria-hidden="true">${icon('check')}</span>
          <h1 class="mb-0">Order placed</h1>
          <p class="muted">Thanks${getState().user?.displayName ? `, ${escapeHtml(getState().user.displayName)}` : ''}! Your meal is booked.</p>
        </div>
        ${adjustedFrom ? `<div class="notice notice-warn mb-0">${icon('info')}<span>
          ${escapeHtml(mealPeriodLabel(adjustedFrom.mealPeriod))} ordering was closed, so we booked
          <strong>${escapeHtml(dayLabel(deliveryDate))} ${escapeHtml(mealPeriodLabel(mealPeriod))}</strong> instead.</span></div>` : ''}
        ${s.replayed ? `<div class="notice mb-0">${icon('info')}<span>This order had already been created — we are showing the original.</span></div>` : ''}
        <dl class="mt-4">
          <div class="kv"><dt>Order number</dt><dd class="order-no">${escapeHtml(order.orderNo || (orderId ? `#${orderId}` : '—'))}</dd></div>
          <div class="kv"><dt>Status</dt><dd>${escapeHtml(order.status || 'Pending')}</dd></div>
          <div class="kv"><dt>Delivery date</dt><dd>${escapeHtml(dayLabel(deliveryDate))} · ${escapeHtml(formatDate(deliveryDate))}</dd></div>
          <div class="kv"><dt>Meal period</dt><dd>${escapeHtml(mealPeriodLabel(mealPeriod))}</dd></div>
          <div class="kv"><dt>Address</dt><dd>${escapeHtml(address)}</dd></div>
          ${quantity ? `<div class="kv"><dt>Servings</dt><dd>${escapeHtml(quantity)}</dd></div>` : ''}
          <div class="kv kv-total"><dt>Total</dt><dd>${escapeHtml(formatCents(totalCents))}</dd></div>
        </dl>
      </div>
    </div>
    <aside class="checkout-aside stack">
      <div class="card card-pad stack-sm">
        <h2>What next?</h2>
        <p class="muted">Track this order, or go back and order for another slot.</p>
        ${orderId ? `<a class="btn btn-primary btn-block" href="#/orders/${encodeURIComponent(orderId)}">View order</a>` : ''}
        <a class="btn btn-outline btn-block" href="#/orders">My orders</a>
        <a class="btn btn-ghost btn-block" href="#/menu">Back to menu</a>
      </div>
    </aside>
  </div>`;
  dom.summary = null;
  dom.lines = null;
  toastSuccess(`Order ${order.orderNo || ''} confirmed.`.trim(), { duration: 5000 });
}

/* --------------------------------------------------------------- helpers */

/** Safe `<option value>` match — avoids building selectors from user text. */
function hasOption(select, value) {
  if (!value) return false;
  return Array.from(select.options || []).some((option) => option.value === value);
}
