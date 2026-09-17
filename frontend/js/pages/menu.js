/* pages/menu.js — the employee home page: browse, search, filter, add to cart.
 * Server-side search / filtering / pagination; live stock over SSE.
 */

import { api, ApiError, normalizePage, isAbort } from '../api.js';
import {
  addToCartFlow, openCart, openAiPanel, setRules, getState,
  cartServings, maxQuantityPerOrder, dishHasOptions, subscribe, applyStockToCart,
} from '../store.js';
import {
  LIMITS, CATEGORIES, escapeHtml, debounce, isRepeatClick, formatCents, icon, stockView,
  spiceLabel, dayLabel, formatDate, todayStr, skeletonCards, emptyStateHtml, errorStateHtml,
  toastError, toastSuccess, imageUrlOr, remainingOf,
} from '../utils.js';
import { navigate } from '../router.js';

const SIZE = 12;

/* Filters survive navigation away and back (module-level, single page instance). */
const view = {
  // Left null so the server decides which day is orderable (today, or the next bookable day once
  // both cut-offs have passed); the response then pins it for subsequent requests.
  date: null,
  page: 0,
  q: '',
  categories: [],
  sort: 'default',
  personalized: false,
  items: [],
  totalElements: 0,
  totalPages: 1,
  facets: [],
  loaded: false,
};

let dom = {};
let abort = null;
let unsubscribeCart = null;
let sse = { source: null, retry: 0, timer: null, closed: true, state: '' };

export async function renderMenuPage(root) {
  view.date = null;

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div>
          <h1 data-role="menu-title">Menu</h1>
          <p class="page-sub" data-role="date-line">Loading the menu…</p>
        </div>
        <div class="page-head-actions">
          <span class="live-pill" data-live-state="connecting" data-role="live" title="Realtime stock updates">
            <span class="dot" aria-hidden="true"></span><span data-role="live-text">Connecting…</span>
          </span>
          <button type="button" class="btn btn-outline" data-ai-open>
            ${icon('sparkles')}<span>AI assistant</span>
          </button>
        </div>
      </header>

      <div class="card toolbar">
        <div class="search">
          <span class="search-icon" aria-hidden="true">${icon('search')}</span>
          <label class="sr-only" for="menu-q">Search dishes</label>
          <input class="input" id="menu-q" name="q" type="search" maxlength="${LIMITS.search}"
                 placeholder="Search dishes…" autocomplete="off" value="${escapeHtml(view.q)}"
                 aria-describedby="menu-q-help">
          <button type="button" class="input-icon" data-clear-search aria-label="Clear search" hidden>${icon('close')}</button>
        </div>
        <div class="row-top stack-sm">
          <div class="chips" role="group" aria-label="Filter by category" data-role="chips"></div>
          <p class="help" id="menu-q-help" data-role="count" aria-live="polite"></p>
        </div>
        <div class="toolbar-row">
          <label class="switch">
            <input type="checkbox" data-role="personalized" ${view.personalized ? 'checked' : ''}>
            <span class="track" aria-hidden="true"></span>
            <span>Recommend for me</span>
          </label>
          <label class="row small">
            <span class="muted strong">Sort</span>
            <span class="select-wrap">
              <select class="select" data-role="sort" aria-label="Sort dishes">
                <option value="default">Recommended order</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="name">Name A–Z</option>
              </select>
            </span>
          </label>
        </div>
      </div>

      <div class="legend" data-role="legend" hidden>
        <span class="legend-item"><span aria-hidden="true">★</span> Recommended for you</span>
        <span class="legend-item"><span aria-hidden="true">●</span> Preferred cuisine</span>
        <span class="legend-item"><span aria-hidden="true">✓</span> Fits your budget</span>
      </div>

      <div data-role="results" class="mt-4">${skeletonCards(6)}</div>
      <nav class="pager" data-role="pager" aria-label="Pagination"></nav>
    </section>`;

  dom = {
    results: root.querySelector('[data-role="results"]'),
    pager: root.querySelector('[data-role="pager"]'),
    count: root.querySelector('[data-role="count"]'),
    chips: root.querySelector('[data-role="chips"]'),
    legend: root.querySelector('[data-role="legend"]'),
    dateLine: root.querySelector('[data-role="date-line"]'),
    title: root.querySelector('[data-role="menu-title"]'),
    live: root.querySelector('[data-role="live"]'),
    liveText: root.querySelector('[data-role="live-text"]'),
    search: root.querySelector('#menu-q'),
    sort: root.querySelector('[data-role="sort"]'),
    personalized: root.querySelector('[data-role="personalized"]'),
  };

  dom.sort.value = view.sort;
  dom.dateLine.textContent = 'Loading the menu…';
  renderChips();
  dom.legend.hidden = !view.personalized;

  /* ---- search (debounced 300 ms, server-side) ---- */
  const runSearch = debounce(() => {
    view.page = 0;
    load();
  }, 300);

  const clearBtn = root.querySelector('[data-clear-search]');
  dom.clearSearch = clearBtn;
  const syncClearButton = () => { clearBtn.hidden = !dom.search.value; };
  syncClearButton();

  dom.search.addEventListener('input', () => {
    const value = dom.search.value.slice(0, LIMITS.search);
    if (dom.search.value !== value) dom.search.value = value;
    view.q = dom.search.value.trim();
    syncClearButton();
    runSearch();
  });
  dom.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      view.q = dom.search.value.trim();
      runSearch.flush();
    }
  });
  clearBtn.addEventListener('click', () => {
    dom.search.value = '';
    view.q = '';
    view.page = 0;
    syncClearButton();
    runSearch.cancel();
    load();
    dom.search.focus();
  });

  /* ---- filters ---- */
  dom.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-cat]');
    if (!chip) return;
    const value = chip.dataset.cat;
    if (value === 'all') {
      view.categories = [];
    } else {
      const set = new Set(view.categories);
      if (set.has(value)) set.delete(value); else set.add(value);
      view.categories = CATEGORIES.filter((c) => set.has(c));
    }
    view.page = 0;
    renderChips();
    load();
  });

  dom.personalized.addEventListener('change', () => {
    view.personalized = dom.personalized.checked;
    dom.legend.hidden = !view.personalized;
    view.page = 0;
    load();
  });

  dom.sort.addEventListener('change', () => {
    view.sort = dom.sort.value;
    view.page = 0;
    load();
  });

  /* ---- delegated grid + pager events ---- */
  dom.results.addEventListener('click', onGridClick);
  dom.pager.addEventListener('click', onPagerClick);
  root.querySelector('[data-ai-open]').addEventListener('click', openAiPanel);

  /* ---- cart changes re-sync the Add buttons ---- */
  unsubscribeCart = subscribe(() => syncAddButtons());

  connectStockStream();
  load();
  return cleanup;
}

function cleanup() {
  if (abort) { try { abort.abort(); } catch (e) { /* noop */ } abort = null; }
  if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }
  sse.closed = true;
  if (sse.timer) { clearTimeout(sse.timer); sse.timer = null; }
  if (sse.source) { try { sse.source.close(); } catch (e) { /* noop */ } sse.source = null; }
  dom = {};
}

/* ------------------------------------------------------------- rendering */

function queryParams() {
  return {
    date: view.date,
    page: view.page,
    size: SIZE,
    q: view.q || null,
    categories: view.categories.length ? view.categories.join(',') : null,
    sort: view.sort !== 'default' ? view.sort : null,
    personalized: view.personalized ? 'true' : null,
  };
}

function menuTitle(date) {
  const label = dayLabel(date);
  if (label === 'Today') return 'Today’s menu';
  if (label === 'Tomorrow') return 'Tomorrow’s menu';
  return `Menu for ${label}`;
}

async function load({ silent = false } = {}) {
  if (abort) abort.abort();
  abort = new AbortController();
  if (!silent) {
    dom.results.innerHTML = skeletonCards(6);
    dom.pager.innerHTML = '';
  }
  try {
    const data = await api.get('/menu', { query: queryParams(), signal: abort.signal });
    const page = normalizePage(data);
    view.items = page.items;
    view.page = page.page;
    view.totalElements = page.totalElements;
    view.totalPages = Math.max(1, page.totalPages);
    view.facets = Array.isArray(data?.categories) ? data.categories : [];
    view.loaded = true;
    if (data?.rules) setRules(data.rules);
    if (data?.date) {
      const serverDate = data.date;
      const changedDate = serverDate !== view.date;
      view.date = serverDate;
      dom.dateLine.textContent = `${dayLabel(data.date)} · ${formatDate(data.date)}`;
      dom.dateLine.title = data.rules?.nextSlot?.label ? `Next ordering slot: ${data.rules.nextSlot.label}` : '';
      if (dom.title) dom.title.textContent = menuTitle(data.date);
      // The stock channel is date-scoped: re-open it when the server's date differs.
      if (changedDate && !sse.closed) {
        if (sse.timer) { clearTimeout(sse.timer); sse.timer = null; }
        if (sse.source) { try { sse.source.close(); } catch (e) { /* noop */ } sse.source = null; }
        sse.retry = 0;
        openStream();
      }
    }
    renderChips();
    renderResults();
    renderPager();
  } catch (err) {
    if (isAbort(err)) return;
    renderError(err);
  }
}

function renderChips() {
  const counts = new Map((view.facets || []).map((f) => [f.value, f.count]));
  const allActive = view.categories.length === 0;
  const chips = [
    `<button type="button" class="chip ${allActive ? 'is-active' : ''}" data-cat="all"
      aria-pressed="${allActive}">All</button>`,
    ...CATEGORIES.map((cat) => {
      const active = view.categories.includes(cat);
      const count = counts.has(cat) ? counts.get(cat) : null;
      return `<button type="button" class="chip ${active ? 'is-active' : ''}" data-cat="${escapeHtml(cat)}"
        aria-pressed="${active}">${escapeHtml(cat)}${count !== null ? `<span class="chip-count">${count}</span>` : ''}</button>`;
    }),
  ];
  dom.chips.innerHTML = chips.join('');
}

function cardHtml(item) {
  const stock = stockView(item);
  const state = addButtonState(item);
  const media = imageUrlOr(item.imageUrl, Number(item.dishId || item.menuId || 1));
  const desc = item.description ? `<p class="dish-desc clamp-2">${escapeHtml(item.description)}</p>` : '';
  const pref = item.preferenceMatch || {};
  const tags = [
    `<span class="tag">${escapeHtml(item.category || 'Dish')}</span>`,
    item.spiceLevel && item.spiceLevel !== 'None'
      ? `<span class="tag tag-muted">${escapeHtml(spiceLabel(item.spiceLevel))}</span>` : '',
    pref.preferredCuisine ? '<span class="tag tag-match">Preferred cuisine</span>' : '',
    pref.spiceMatch && !pref.preferredCuisine ? '<span class="tag tag-match">Spice match</span>' : '',
  ].filter(Boolean).join('');

  const allergens = Array.isArray(item.allergens) && item.allergens.length
    ? `<p class="tiny muted mb-0">Allergens: ${escapeHtml(item.allergens.join(', '))}</p>` : '';

  return `<article class="dish-card ${item.recommended ? 'is-recommended' : ''} ${item.soldOut ? 'is-soldout' : ''}"
      data-menu-id="${escapeHtml(item.menuId)}" data-card>
    <a class="dish-media" href="#/dish/${escapeHtml(item.menuId)}" aria-label="View ${escapeHtml(item.name)}">
      <img src="${escapeHtml(media)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" width="480" height="300">
      ${stock.text ? `<span class="badge badge-stock ${stock.cls}" data-role="stock-badge">${escapeHtml(stock.text)}</span>` : ''}
      ${item.recommended ? '<span class="badge badge-reco">★ Recommended</span>' : ''}
    </a>
    <div class="dish-body">
      <h3 class="dish-name"><a href="#/dish/${escapeHtml(item.menuId)}">${escapeHtml(item.name)}</a></h3>
      <div class="dish-meta">${tags}</div>
      ${desc}
      ${allergens}
      <div class="dish-foot">
        <span class="price" data-role="price">${escapeHtml(formatCents(item.priceCents))}</span>
        <button type="button" class="btn btn-primary btn-sm" data-add="${escapeHtml(item.menuId)}"
          ${state.disabled ? 'disabled' : ''} title="${escapeHtml(state.title)}"
          aria-label="${escapeHtml(`${state.label} — ${item.name}`)}">${escapeHtml(state.label)}</button>
      </div>
    </div>
  </article>`;
}

function renderResults() {
  if (!view.items.length) {
    const filtered = view.q || view.categories.length;
    dom.results.innerHTML = emptyStateHtml({
      title: filtered ? 'No dishes match' : 'No dishes on the menu',
      message: filtered
        ? `Nothing matched your filters${view.q ? ` for “${view.q}”` : ''}. Try another keyword or clear the filters.`
        : `No dishes are scheduled for ${dayLabel(view.date)}. Check back later or pick another day.`,
      actionLabel: filtered ? 'Clear filters' : '',
      actionAttrs: 'data-clear-filters',
    });
    const clear = dom.results.querySelector('[data-clear-filters]');
    if (clear) {
      clear.addEventListener('click', () => {
        view.q = '';
        view.categories = [];
        dom.search.value = '';
        if (dom.clearSearch) dom.clearSearch.hidden = true;
        renderChips();
        view.page = 0;
        load();
      });
    }
    return;
  }
  dom.results.innerHTML = `<div class="dish-grid">${view.items.map(cardHtml).join('')}</div>`;
}

function renderCount() {
  const total = view.totalElements;
  if (!total) {
    dom.count.textContent = view.q || view.categories.length ? 'No matching dishes' : 'No dishes available';
    return;
  }
  const from = view.page * SIZE + 1;
  const to = Math.min(total, (view.page + 1) * SIZE);
  dom.count.textContent = `Showing ${from}–${to} of ${total} dishes`;
}

function renderPager() {
  renderCount();
  if (view.totalPages <= 1) { dom.pager.innerHTML = ''; return; }

  const current = view.page;
  const last = view.totalPages - 1;
  const numbers = [];
  const push = (n) => { numbers.push(n); };
  push(0);
  for (let i = current - 1; i <= current + 1; i += 1) {
    if (i > 0 && i < last) push(i);
  }
  if (last > 0) push(last);

  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  let lastRendered = -1;
  const parts = unique.map((n) => {
    const gap = lastRendered >= 0 && n - lastRendered > 1;
    lastRendered = n;
    const btn = `<button type="button" class="pager-num ${n === current ? 'is-active' : ''}"
        data-page="${n}" ${n === current ? 'aria-current="page"' : ''}
        aria-label="Page ${n + 1}">${n + 1}</button>`;
    return gap ? `<span class="pager-gap" aria-hidden="true">…</span>${btn}` : btn;
  });

  dom.pager.innerHTML = `
    <button type="button" class="pager-num" data-page="${current - 1}" ${current === 0 ? 'disabled' : ''}
      aria-label="Previous page">Prev</button>
    ${parts.join('')}
    <button type="button" class="pager-num" data-page="${current + 1}" ${current >= last ? 'disabled' : ''}
      aria-label="Next page">Next</button>`;
}

function renderError(err) {
  const message = err instanceof ApiError ? err.message : 'Could not load the menu.';
  dom.results.innerHTML = errorStateHtml({ title: 'Menu unavailable', message, retryAttrs: 'data-retry="menu"' });
  dom.pager.innerHTML = '';
  dom.count.textContent = '';
  const retry = dom.results.querySelector('[data-retry]');
  if (retry) retry.addEventListener('click', () => load());
  if (err instanceof ApiError && err.code === 'NETWORK_ERROR') toastError(message);
}

/* ------------------------------------------------------- add to cart logic */

function qtyInCartForMenu(menuId) {
  return getState().cart
    .filter((line) => Number(line.menuId) === Number(menuId))
    .reduce((acc, line) => acc + line.quantity, 0);
}

/** Visible reason why the Add button is disabled (or the action to take). */
function addButtonState(item) {
  const max = maxQuantityPerOrder();
  const remaining = remainingOf(item);
  if (item.soldOut || (remaining !== null && remaining <= 0)) {
    return { disabled: true, label: 'Sold out', title: 'This dish is sold out for today.' };
  }
  if (cartServings() >= max) {
    return { disabled: true, label: `Max ${max} servings`, title: `Your cart already has ${max} servings — the per-order maximum.` };
  }
  if (remaining !== null && qtyInCartForMenu(item.menuId) >= remaining) {
    return { disabled: true, label: 'Stock limit', title: `Only ${remaining} left and they are already in your cart.` };
  }
  if (dishHasOptions(item)) {
    return { disabled: false, label: 'Choose options', title: 'Pick your options before adding to the cart.' };
  }
  return { disabled: false, label: 'Add', title: 'Add to cart' };
}

function syncAddButtons() {
  if (!dom.results) return;
  dom.results.querySelectorAll('[data-card]').forEach((card) => {
    const menuId = card.dataset.menuId;
    const item = view.items.find((it) => String(it.menuId) === String(menuId));
    const btn = card.querySelector('[data-add]');
    if (!item || !btn || btn.dataset.pending === '1') return;
    const state = addButtonState(item);
    btn.disabled = state.disabled;
    btn.textContent = state.label;
    btn.title = state.title;
  });
}

async function onGridClick(event) {
  const btn = event.target.closest('[data-add]');
  if (!btn || btn.disabled) return;
  if (isRepeatClick(btn, 250)) return;

  const menuId = btn.dataset.add;
  const item = view.items.find((it) => String(it.menuId) === String(menuId));
  if (!item) return;

  if (dishHasOptions(item)) {
    navigate(`/dish/${menuId}`);
    return;
  }

  // Pending state blocks further clicks and states the reason visibly.
  btn.dataset.pending = '1';
  btn.disabled = true;
  btn.textContent = 'Adding…';

  const result = await addToCartFlow(item, { quantity: 1 });

  delete btn.dataset.pending;
  if (result.ok) {
    btn.disabled = true;
    btn.textContent = 'Added ✓';
    toastSuccess(`${item.name} added to your cart.`, {
      actionLabel: 'View cart',
      onAction: openCart,
      duration: 2600,
    });
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      const state = addButtonState(item);
      btn.disabled = state.disabled;
      btn.textContent = state.label;
    }, 700);
  } else {
    const state = addButtonState(item);
    btn.disabled = state.disabled;
    btn.textContent = state.label;
  }
}

function onPagerClick(event) {
  const btn = event.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  const page = Number(btn.dataset.page);
  if (!Number.isFinite(page) || page === view.page || page < 0 || page >= view.totalPages) return;
  if (isRepeatClick(btn, 250)) return;
  view.page = page;
  load();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* --------------------------------------------------- realtime stock (SSE) */

function setLiveState(stateName, text) {
  sse.state = stateName;
  if (!dom.live) return;
  dom.live.dataset.liveState = stateName;
  dom.liveText.textContent = text;
}

function connectStockStream() {
  sse.closed = false;
  if (typeof window.EventSource !== 'function') {
    setLiveState('error', 'Live off');
    return;
  }
  openStream();
}

function openStream() {
  if (sse.closed) return;
  try {
    const source = new EventSource(api.sseUrl('/stream/stock', { date: view.date }));
    sse.source = source;

    source.onopen = () => {
      sse.retry = 0;
      setLiveState('open', 'Live');
    };
    source.addEventListener('snapshot', (event) => onStockEvent(event));
    source.addEventListener('stock', (event) => onStockEvent(event));
    source.onerror = () => {
      try { source.close(); } catch (e) { /* noop */ }
      if (sse.source === source) sse.source = null;
      if (sse.closed) return;
      setLiveState('error', 'Reconnecting…');
      const delay = Math.min(30000, 1000 * (2 ** sse.retry));
      sse.retry += 1;
      sse.timer = setTimeout(openStream, delay);
    };
  } catch (err) {
    setLiveState('error', 'Live off');
  }
}

function onStockEvent(event) {
  let payload = null;
  try { payload = JSON.parse(event.data); } catch (err) { return; }
  if (!payload || !Array.isArray(payload.items)) return;
  if (payload.date && payload.date !== view.date) return;
  setLiveState('open', 'Live');
  applyStockToCart(payload.items);
  let changed = false;

  payload.items.forEach((update) => {
    const item = view.items.find((it) => String(it.menuId) === String(update.menuId));
    if (!item) return;
    const before = `${item.remaining}|${item.soldOut}`;
    item.remaining = Number(update.remaining);
    item.soldOut = Boolean(update.soldOut) || item.remaining <= 0;
    item.lowStock = Boolean(update.lowStock);
    if (`${item.remaining}|${item.soldOut}` !== before) {
      changed = true;
      patchCard(item);
    }
  });

  if (changed) syncAddButtons();
}

/** Update one card in place — no re-render, no lost focus/scroll. */
function patchCard(item) {
  if (!dom.results) return;
  const card = dom.results.querySelector(`[data-card][data-menu-id="${Number(item.menuId)}"]`);
  if (!card) return;
  const stock = stockView(item);
  const badge = card.querySelector('[data-role="stock-badge"]');
  if (badge) {
    if (stock.text) {
      badge.textContent = stock.text;
      badge.className = `badge badge-stock ${stock.cls}`;
    }
  } else if (stock.text) {
    const media = card.querySelector('.dish-media');
    if (media) {
      const span = document.createElement('span');
      span.className = `badge badge-stock ${stock.cls}`;
      span.dataset.role = 'stock-badge';
      span.textContent = stock.text;
      media.appendChild(span);
    }
  }
  card.classList.toggle('is-soldout', Boolean(item.soldOut));
  card.classList.add('is-flash');
  window.setTimeout(() => card.classList.remove('is-flash'), 900);
}
