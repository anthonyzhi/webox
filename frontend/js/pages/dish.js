/* pages/dish.js — dish detail with option groups, live price and quantity. */

import { api, ApiError, isAbort } from '../api.js';
import {
  addToCartFlow, openCart, getState, cartServings, maxQuantityPerOrder, setRules, subscribe,
} from '../store.js';
import {
  escapeHtml, formatCents, formatExtraCents, stockView, spiceLabel, isRepeatClick,
  skeletonLines, errorStateHtml, toastSuccess, imageUrlOr, optionsSummary,
} from '../utils.js';
import { navigate } from '../router.js';

export async function renderDishPage(root, params) {
  const menuId = Number(params?.menuId);
  if (!Number.isFinite(menuId)) {
    renderNotFound(root, 'That dish link looks broken.');
    return () => {};
  }

  root.innerHTML = `<section class="page">
    <nav class="breadcrumb"><a href="#/menu">← Back to menu</a></nav>
    ${skeletonLines(6)}
  </section>`;

  let item = null;
  let rules = null;
  try {
    // The endpoint answers with { item, rules }: the item carries its option groups, the rules carry
    // the ordering window (cut-offs still come from the server, never from the browser clock).
    const response = await api.get(`/menu/items/${menuId}`);
    item = response?.item || null;
    rules = response?.rules || null;
  } catch (err) {
    if (isAbort(err)) return () => {};
    const message = err instanceof ApiError && err.code === 'MENU_ITEM_NOT_FOUND'
      ? 'This dish is not on today’s menu any more.'
      : (err?.message || 'Could not load this dish.');
    root.innerHTML = `<section class="page">
      <nav class="breadcrumb"><a href="#/menu">← Back to menu</a></nav>
      ${errorStateHtml({ title: 'Dish unavailable', message, retryLabel: 'Back to menu', retryAttrs: 'data-back' })}
    </section>`;
    root.querySelector('[data-back]')?.addEventListener('click', () => navigate('/menu'));
    return () => {};
  }

  if (!item || !item.menuId) {
    renderNotFound(root, 'This dish is not available right now.');
    return () => {};
  }

  if (rules) setRules(rules);
  return mount(root, item);
}

function renderNotFound(root, message) {
  root.innerHTML = `<section class="page">
    <nav class="breadcrumb"><a href="#/menu">← Back to menu</a></nav>
    ${errorStateHtml({ title: 'Dish not found', message, retryLabel: 'Back to menu', retryAttrs: 'data-back' })}
  </section>`;
  root.querySelector('[data-back]')?.addEventListener('click', () => navigate('/menu'));
}

function mount(root, item) {
  const groups = (item.optionGroups || []).filter((g) => (g.options || []).length > 0);
  const selected = new Map(groups.map((g) => [Number(g.id), new Set()]));
  let quantity = 1;
  let unsubscribe = null;

  const stock = stockView(item);
  const media = imageUrlOr(item.imageUrl, Number(item.dishId || item.menuId));

  root.innerHTML = `<section class="page">
    <nav class="breadcrumb"><a href="#/menu">← Back to menu</a></nav>
    <div class="detail">
      <div>
        <div class="detail-media">
          <img src="${escapeHtml(media)}" alt="${escapeHtml(item.name)}" width="800" height="500">
        </div>
        <div class="card card-pad mt-4">
          <h2>About this dish</h2>
          <p class="muted">${escapeHtml(item.description || 'No description provided.')}</p>
          <dl class="meta-list">
            <div class="meta-item"><dt>Protein source</dt><dd>${escapeHtml(item.protein || 'Not specified')}</dd></div>
            <div class="meta-item"><dt>Spice level</dt><dd>${escapeHtml(spiceLabel(item.spiceLevel))}</dd></div>
            <div class="meta-item"><dt>Category</dt><dd>${escapeHtml(item.category || '—')}</dd></div>
            <div class="meta-item"><dt>Allergens</dt><dd>${escapeHtml(
              Array.isArray(item.allergens) && item.allergens.length ? item.allergens.join(', ') : 'None declared',
            )}</dd></div>
            <div class="meta-item"><dt>Availability</dt><dd data-role="availability">${escapeHtml(stock.text || 'Available')}</dd></div>
          </dl>
        </div>
      </div>

      <div class="detail-side">
        <div class="card card-pad">
          <div class="detail-title-row">
            <h1 class="grow mb-0">${escapeHtml(item.name)}</h1>
            ${stock.text ? `<span class="badge badge-stock ${stock.cls}" data-role="stock-badge">${escapeHtml(stock.text)}</span>` : ''}
            ${item.recommended ? '<span class="badge badge-reco">★ Recommended</span>' : ''}
          </div>
          <p class="price-lg mt-2" data-role="price">${escapeHtml(formatCents(item.priceCents))}</p>
          <p class="help" data-role="price-note">Base price</p>

          <div class="mt-4" data-role="groups"></div>

          <div class="spread mt-4">
            <div>
              <div class="label">Quantity</div>
              <div class="qty" role="group" aria-label="Quantity">
                <button type="button" class="qty-btn" data-qty="-1" aria-label="Decrease quantity">−</button>
                <span class="qty-value" data-role="qty" aria-live="polite">1</span>
                <button type="button" class="qty-btn" data-qty="1" aria-label="Increase quantity">+</button>
              </div>
            </div>
            <p class="help right mb-0" data-role="qty-help"></p>
          </div>

          <p class="field-error mt-3" data-role="hint" role="status"></p>

          <button type="button" class="btn btn-primary btn-lg btn-block mt-3" data-add>Add to cart</button>
          <p class="help center mt-2">Maximum ${maxQuantityPerOrder()} servings per order.</p>
        </div>
      </div>
    </div>

    <div class="sticky-bar">
      <div class="grow">
        <div class="tiny muted">Total</div>
        <div class="price" data-role="price">${escapeHtml(formatCents(item.priceCents))}</div>
      </div>
      <button type="button" class="btn btn-primary" data-add>Add to cart</button>
    </div>
  </section>`;

  const groupsHost = root.querySelector('[data-role="groups"]');
  groupsHost.innerHTML = groups.map(groupHtml).join('');

  const addButtons = Array.from(root.querySelectorAll('[data-add]'));
  const qtyValue = root.querySelector('[data-role="qty"]');
  const qtyHelp = root.querySelector('[data-role="qty-help"]');
  const hint = root.querySelector('[data-role="hint"]');
  const priceEls = Array.from(root.querySelectorAll('[data-role="price"]'));
  const priceNote = root.querySelector('[data-role="price-note"]');

  /* ---- option wiring ---- */
  groupsHost.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-group]');
    if (!input) return;
    const groupId = Number(input.dataset.group);
    const optionId = Number(input.value);
    const group = groups.find((g) => Number(g.id) === groupId);
    const set = selected.get(groupId);
    if (!set || !group) return;

    if (group.multiSelect) {
      if (input.checked) set.add(optionId); else set.delete(optionId);
    } else {
      set.clear();
      set.add(optionId);
    }
    sync();
  });

  /* ---- quantity wiring (repeat clicks ignored for 250 ms) ---- */
  root.querySelectorAll('[data-qty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (isRepeatClick(btn, 250)) return;
      const next = quantity + Number(btn.dataset.qty);
      const capacity = maxQuantity();
      if (next < 1 || next > capacity) return;
      quantity = next;
      sync();
    });
  });

  /* ---- add ---- */
  addButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      if (isRepeatClick(btn, 250)) return;
      const options = selectedOptions();
      const before = btn.innerHTML;
      addButtons.forEach((b) => { b.disabled = true; b.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Adding…</span>'; });
      const result = await addToCartFlow(item, { quantity, options });
      addButtons.forEach((b) => { b.innerHTML = before; });
      if (result.ok) {
        const summary = optionsSummary(options);
        toastSuccess(`${quantity} × ${item.name} added.${summary ? ` (${summary})` : ''}`, {
          actionLabel: 'View cart',
          onAction: openCart,
          duration: 3200,
        });
        quantity = 1;
        sync();
        openCart();
      } else {
        sync();
      }
    });
  });

  unsubscribe = subscribe(sync);

  /* ---- derived state ---- */
  function selectedOptions() {
    const list = [];
    groups.forEach((group) => {
      const set = selected.get(Number(group.id));
      if (!set || !set.size) return;
      (group.options || []).forEach((option) => {
        if (set.has(Number(option.id))) {
          list.push({ ...option, groupName: group.name, extraPriceCents: Number(option.extraPriceCents) || 0 });
        }
      });
    });
    return list;
  }

  function optionsPrice() {
    return selectedOptions().reduce((acc, opt) => acc + (Number(opt.extraPriceCents) || 0), 0);
  }

  function unitPrice() {
    return Math.round(Number(item.priceCents) || 0) + optionsPrice();
  }

  function missingRequired() {
    return groups.filter((g) => g.required && !(selected.get(Number(g.id)) || new Set()).size);
  }

  function existingLineQuantity() {
    const optionIds = selectedOptions().map((o) => Number(o.id)).sort((a, b) => a - b).join('-');
    const key = `${item.menuId}#${optionIds}`;
    const line = getState().cart.find((l) => l.key === key);
    return line ? line.quantity : 0;
  }

  function maxQuantity() {
    const perOrder = maxQuantityPerOrder();
    const otherServings = cartServings() - existingLineQuantity();
    const stockCap = Number.isFinite(Number(item.remaining)) ? Number(item.remaining) : perOrder;
    return Math.max(0, Math.min(perOrder - otherServings, stockCap));
  }

  function quantityLimitReason() {
    const perOrder = maxQuantityPerOrder();
    if (Number.isFinite(Number(item.remaining)) && Number(item.remaining) <= 0) return 'This dish is sold out.';
    if (cartServings() - existingLineQuantity() >= perOrder) return `Only ${perOrder} servings per order.`;
    if (Number.isFinite(Number(item.remaining)) && Number(item.remaining) < perOrder) {
      return `Only ${item.remaining} left in stock.`;
    }
    return '';
  }

  function sync() {
    const price = unitPrice();
    const extras = optionsPrice();
    priceEls.forEach((el) => { el.textContent = formatCents(price); });
    if (priceNote) {
      priceNote.textContent = extras > 0
        ? `Base ${formatCents(item.priceCents)} + options ${formatCents(extras)}`
        : 'Base price';
    }

    const missing = missingRequired();
    groupsHost.querySelectorAll('.opt-group').forEach((fieldset) => {
      const groupId = Number(fieldset.dataset.groupId);
      fieldset.classList.toggle('is-missing', missing.some((g) => Number(g.id) === groupId));
    });

    const capacity = maxQuantity();
    if (quantity > capacity) quantity = Math.max(1, capacity);
    qtyValue.textContent = String(quantity);
    const increase = root.querySelector('[data-qty="1"]');
    const decrease = root.querySelector('[data-qty="-1"]');
    if (increase) {
      increase.disabled = quantity >= capacity;
      increase.title = increase.disabled ? (quantityLimitReason() || 'Maximum quantity reached.') : 'Add one more serving';
    }
    if (decrease) decrease.disabled = quantity <= 1;
    if (qtyHelp) qtyHelp.textContent = `${capacity} available`;

    const soldOut = Boolean(item.soldOut) || (Number.isFinite(Number(item.remaining)) && Number(item.remaining) <= 0);
    const blocked = soldOut || missing.length > 0 || capacity < 1;
    addButtons.forEach((btn) => { btn.disabled = blocked; });

    if (soldOut) {
      hint.textContent = 'This dish is sold out for today.';
    } else if (capacity < 1) {
      hint.textContent = quantityLimitReason() || `Maximum ${maxQuantityPerOrder()} servings per order.`;
    } else if (missing.length) {
      hint.textContent = `Choose ${missing.map((g) => g.name).join(', ')} to continue.`;
    } else {
      hint.textContent = '';
    }
  }

  sync();
  return () => { if (unsubscribe) unsubscribe(); };
}

function groupHtml(group) {
  const inputType = group.multiSelect ? 'checkbox' : 'radio';
  const name = `group-${group.id}`;
  const options = (group.options || []).map((option) => {
    const extra = Number(option.extraPriceCents) || 0;
    return `<label class="opt">
      <input type="${inputType}" name="${escapeHtml(name)}" value="${escapeHtml(option.id)}"
             data-group="${escapeHtml(group.id)}">
      <span class="opt-name">${escapeHtml(option.name)}</span>
      ${extra > 0 ? `<span class="opt-extra">${escapeHtml(formatExtraCents(extra))}</span>` : ''}
    </label>`;
  }).join('');

  return `<fieldset class="opt-group" data-group-id="${escapeHtml(group.id)}">
    <legend>${escapeHtml(group.name)}
      ${group.required ? '<span class="req">Required</span>' : '<span class="tag tag-muted">Optional</span>'}
    </legend>
    <p class="opt-hint">${group.multiSelect ? 'Choose as many as you like.' : 'Choose one.'}</p>
    ${options}
  </fieldset>`;
}
