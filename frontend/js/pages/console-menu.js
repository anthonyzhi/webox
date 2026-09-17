/* pages/console-menu.js — compose a day's menu: pick active dishes with per-dish quantities. */

import { api, ApiError, normalizePage, isAbort } from '../api.js';
import {
  LIMITS, escapeHtml, formatCents, dayLabel, formatDate, todayStr, tomorrowStr, debounce,
  icon, skeletonLines, errorStateHtml, toast, toastSuccess, setBusy,
  isRepeatClick, readInt, pluralize, stockView,
} from '../utils.js';

const state = {
  date: tomorrowStr(),
  rows: [],       // [{ dishId, name, category, imageUrl, priceCents, totalQuantity, soldQuantity, remaining, active, selected }]
  filter: '',
  loading: true,
  dirty: false,
  saving: false,
};

let dom = {};
let existingRows = [];

export async function renderConsoleMenu(root) {
  state.date = state.date || tomorrowStr();
  state.filter = '';
  state.dirty = false;

  root.innerHTML = `<section class="page">
    <header class="page-head">
      <div>
        <h1>Daily menu</h1>
        <p class="page-sub">Choose which active dishes are available on a given day, and how many servings.</p>
      </div>
      <div class="page-head-actions">
        <button type="button" class="btn btn-primary" data-save>${icon('check')}<span>Save daily menu</span></button>
      </div>
    </header>

    <div class="card filters-bar">
      <div class="field mb-0">
        <label class="label" for="dm-date">Menu date</label>
        <div class="row">
          <input class="input" id="dm-date" type="date" value="${escapeHtml(state.date)}" min="${escapeHtml(todayStr())}">
          <button type="button" class="btn btn-outline btn-sm" data-today>Today</button>
          <button type="button" class="btn btn-outline btn-sm" data-tomorrow>Tomorrow</button>
        </div>
      </div>
      <div class="search">
        <span class="search-icon" aria-hidden="true">${icon('search')}</span>
        <label class="sr-only" for="dm-search">Search dishes</label>
        <input class="input" id="dm-search" type="search" maxlength="${LIMITS.search}" placeholder="Search dishes…" autocomplete="off">
        <button type="button" class="input-icon" data-clear-search aria-label="Clear search" hidden>${icon('close')}</button>
      </div>
      <p class="help mb-0" data-role="summary" aria-live="polite"></p>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <h2>Dishes</h2>
          <span class="badge badge-neutral" data-role="dish-count"></span>
        </div>
        <div class="card-body">
          <div class="pick-list" data-role="list">${skeletonLines(5)}</div>
        </div>
      </div>
      <aside class="stack">
        <div class="card card-pad">
          <h2>Selected</h2>
          <div class="stack-sm" data-role="selected"><p class="muted mb-0">Nothing selected yet.</p></div>
        </div>
        <div class="card card-pad">
          <h3>Saving</h3>
          <p class="help">Saving replaces the whole day. Dishes with existing sales cannot be dropped.</p>
          <button type="button" class="btn btn-primary btn-block" data-save>Save daily menu</button>
        </div>
      </aside>
    </div>
  </section>`;

  dom = {
    date: root.querySelector('#dm-date'),
    search: root.querySelector('#dm-search'),
    list: root.querySelector('[data-role="list"]'),
    selected: root.querySelector('[data-role="selected"]'),
    summary: root.querySelector('[data-role="summary"]'),
    dishCount: root.querySelector('[data-role="dish-count"]'),
    saveButtons: Array.from(root.querySelectorAll('[data-save]')),
  };

  dom.date.addEventListener('change', () => {
    state.date = dom.date.value || tomorrowStr();
    load();
  });
  root.querySelector('[data-today]').addEventListener('click', () => {
    state.date = todayStr();
    dom.date.value = state.date;
    load();
  });
  root.querySelector('[data-tomorrow]').addEventListener('click', () => {
    state.date = tomorrowStr();
    dom.date.value = state.date;
    load();
  });

  const clearSearch = root.querySelector('[data-clear-search]');
  const runFilter = debounce(() => {
    state.filter = dom.search.value.slice(0, LIMITS.search).toLowerCase();
    renderList();
  }, 300);
  dom.search.addEventListener('input', () => {
    const value = dom.search.value.slice(0, LIMITS.search);
    if (dom.search.value !== value) dom.search.value = value;
    clearSearch.hidden = !dom.search.value;
    runFilter();
  });
  clearSearch.addEventListener('click', () => {
    dom.search.value = '';
    state.filter = '';
    clearSearch.hidden = true;
    runFilter.cancel();
    renderList();
    dom.search.focus();
  });

  dom.list.addEventListener('change', onListChange);
  dom.list.addEventListener('input', onListInput);

  dom.saveButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isRepeatClick(btn, 400)) return;
      save();
    });
  });

  await load();
  return () => { dom = {}; };
}

/* --------------------------------------------------------------- data load */

async function load() {
  state.loading = true;
  state.dirty = false;
  if (dom.list) dom.list.innerHTML = skeletonLines(5);
  try {
    const [daily, dishes] = await Promise.all([fetchDailyMenu(), fetchAllActiveDishes()]);
    existingRows = Array.isArray(daily?.items) ? daily.items : [];
    const byDishId = new Map(existingRows.map((row) => [Number(row.dishId), row]));

    state.rows = dishes.map((dish) => {
      const existing = byDishId.get(Number(dish.id));
      return {
        dishId: Number(dish.id),
        name: dish.name,
        category: dish.category || '',
        imageUrl: dish.imageUrl || '',
        priceCents: Number(dish.priceCents) || 0,
        active: dish.active !== false,
        totalQuantity: existing ? Number(existing.totalQuantity) || 0 : 0,
        soldQuantity: existing ? Number(existing.soldQuantity) || 0 : 0,
        remaining: existing ? Number(existing.remaining) : null,
        selected: Boolean(existing),
      };
    });

    // Rows that exist on the day but are no longer active still need to be visible.
    existingRows.forEach((row) => {
      if (state.rows.some((r) => r.dishId === Number(row.dishId))) return;
      state.rows.push({
        dishId: Number(row.dishId),
        name: row.dishName || `Dish ${row.dishId}`,
        category: row.category || '',
        imageUrl: row.imageUrl || '',
        priceCents: Number(row.priceCents) || 0,
        active: false,
        totalQuantity: Number(row.totalQuantity) || 0,
        soldQuantity: Number(row.soldQuantity) || 0,
        remaining: Number(row.remaining),
        selected: true,
      });
    });

    state.rows.sort((a, b) => a.name.localeCompare(b.name));
    state.loading = false;
    renderList();
    renderSelected();
    if (dom.date) dom.date.value = state.date;
  } catch (err) {
    if (isAbort(err)) return;
    state.loading = false;
    if (dom.list) {
      dom.list.innerHTML = errorStateHtml({
        title: 'Could not load the daily menu',
        message: err?.message || 'Please try again.',
        retryAttrs: 'data-retry-daily',
      });
      dom.list.querySelector('[data-retry-daily]')?.addEventListener('click', () => load());
    }
  }
}

async function fetchDailyMenu() {
  return api.get('/admin/daily-menu', { query: { date: state.date } });
}

async function fetchAllActiveDishes() {
  const all = [];
  let page = 0;
  // The catalog is small, but page defensively so this keeps working as it grows.
  while (page < 10) {
    const data = await api.get('/admin/dishes', { query: { active: 'true', page, size: 100 } });
    const normalized = normalizePage(data);
    all.push(...normalized.items);
    if (page + 1 >= normalized.totalPages) break;
    page += 1;
  }
  return all;
}

/* --------------------------------------------------------------- rendering */

function visibleRows() {
  if (!state.filter) return state.rows;
  return state.rows.filter((row) => `${row.name} ${row.category}`.toLowerCase().includes(state.filter));
}

function renderList() {
  if (!dom.list) return;
  const rows = visibleRows();
  if (!rows.length) {
    dom.list.innerHTML = `<p class="muted mb-0">No dishes match “${escapeHtml(state.filter)}”.</p>`;
    return;
  }
  dom.list.innerHTML = rows.map((row) => {
    const stock = stockView({ remaining: row.soldQuantity > 0 ? Math.max(0, row.totalQuantity - row.soldQuantity) : row.remaining, soldOut: false });
    const sold = row.soldQuantity > 0
      ? `<span class="badge badge-info">${escapeHtml(`${row.soldQuantity}/${row.totalQuantity} sold`)}</span>`
      : '';
    return `<div class="pick-row ${row.selected ? 'is-selected' : ''}" data-row="${row.dishId}">
      <input type="checkbox" data-pick ${row.selected ? 'checked' : ''}
             aria-label="Include ${escapeHtml(row.name)} on ${escapeHtml(dayLabel(state.date))}">
      <span>
        <span class="pick-name">${escapeHtml(row.name)}</span>
        <span class="pick-sub">${escapeHtml(row.category)} · ${escapeHtml(formatCents(row.priceCents))}${row.active ? '' : ' · inactive'}</span>
        ${stock.cls === 'is-low' ? `<span class="pick-sub">${escapeHtml(stock.text)}</span>` : ''}
      </span>
      <span class="row">
        ${sold}
        <input class="input qty-input" type="number" min="0" max="${LIMITS.maxQuantity}" step="1"
               value="${row.totalQuantity}" data-qty-input ${row.selected ? '' : 'disabled'}
               aria-label="Servings of ${escapeHtml(row.name)}">
      </span>
    </div>`;
  }).join('');
  if (dom.dishCount) dom.dishCount.textContent = `${rows.length} shown`;
  updateSummary();
}

function renderSelected() {
  if (!dom.selected) return;
  const selected = state.rows.filter((row) => row.selected);
  if (!selected.length) {
    dom.selected.innerHTML = '<p class="muted mb-0">Nothing selected yet.</p>';
    updateSummary();
    return;
  }
  dom.selected.innerHTML = selected
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => `<div class="spread small">
      <span>${escapeHtml(row.name)}${row.soldQuantity > 0 ? ` <span class="tiny muted">(${row.soldQuantity} sold)</span>` : ''}</span>
      <span class="strong">${row.totalQuantity}</span>
    </div>`).join('');
  updateSummary();
}

function updateSummary() {
  if (!dom.summary) return;
  const selected = state.rows.filter((row) => row.selected);
  const servings = selected.reduce((acc, row) => acc + row.totalQuantity, 0);
  dom.summary.textContent = `${pluralize(selected.length, 'dish', 'dishes')} selected · ${pluralize(servings, 'serving')} for ${dayLabel(state.date)}, ${formatDate(state.date)}`;
}

/* ------------------------------------------------------------- interaction */

function onListChange(event) {
  const pick = event.target.closest('[data-pick]');
  if (pick) {
    const rowEl = pick.closest('[data-row]');
    const row = state.rows.find((r) => String(r.dishId) === rowEl.dataset.row);
    if (!row) return;
    row.selected = pick.checked;
    if (row.selected && row.totalQuantity === 0) row.totalQuantity = 20;
    rowEl.classList.toggle('is-selected', row.selected);
    const qtyInput = rowEl.querySelector('[data-qty-input]');
    if (qtyInput) {
      qtyInput.disabled = !row.selected;
      qtyInput.value = String(row.totalQuantity);
    }
    state.dirty = true;
    renderSelected();
    updateSummary();
    return;
  }
}

function onListInput(event) {
  const qtyInput = event.target.closest('[data-qty-input]');
  if (!qtyInput) return;
  const rowEl = qtyInput.closest('[data-row]');
  const row = state.rows.find((r) => String(r.dishId) === rowEl.dataset.row);
  if (!row) return;
  const value = readInt(qtyInput.value, { min: 0, max: LIMITS.maxQuantity, fallback: 0 });
  row.totalQuantity = value;
  if (value === 0 && row.selected) {
    row.selected = false;
    const pick = rowEl.querySelector('[data-pick]');
    if (pick) pick.checked = false;
    rowEl.classList.remove('is-selected');
  } else if (value > 0 && !row.selected) {
    row.selected = true;
    const pick = rowEl.querySelector('[data-pick]');
    if (pick) pick.checked = true;
    rowEl.classList.add('is-selected');
  }
  state.dirty = true;
  renderSelected();
  updateSummary();
}

/* ------------------------------------------------------------------- save */

async function save() {
  if (state.saving) return;
  const items = state.rows
    .filter((row) => row.selected && row.totalQuantity > 0)
    .map((row) => ({ dishId: row.dishId, totalQuantity: row.totalQuantity }));

  if (!items.length) {
    toast('Select at least one dish with servings greater than zero.', { type: 'warn' });
    return;
  }

  state.saving = true;
  dom.saveButtons.forEach((btn) => setBusy(btn, true, 'Saving…'));
  try {
    await api.put('/admin/daily-menu', { date: state.date, items });
    state.dirty = false;
    toastSuccess(`Daily menu saved for ${dayLabel(state.date)}.`);
    await load();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'MENU_HAS_SALES') {
      const detailNames = extractSoldDishNames(err);
      toast(err.message || 'A dish with existing sales cannot be removed.', { type: 'error', title: 'Menu has sales' });
      if (detailNames.length) {
        toast(`Dishes with sales: ${detailNames.join(', ')}. Keep them on the menu and try again.`, { type: 'warn', duration: 8000 });
      }
      if (dom.list) {
        dom.list.querySelectorAll('[data-row]').forEach((rowEl) => {
          const row = state.rows.find((r) => String(r.dishId) === rowEl.dataset.row);
          if (row && row.soldQuantity > 0 && !row.selected) {
            rowEl.style.borderLeft = '4px solid var(--warn)';
          }
        });
      }
    } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
      toast(err.message || 'Please check the quantities and try again.', { type: 'error' });
    } else {
      toast(err?.message || 'Could not save the daily menu.', { type: 'error' });
    }
  } finally {
    state.saving = false;
    dom.saveButtons.forEach((btn) => setBusy(btn, false));
  }
}

function extractSoldDishNames(err) {
  const details = err?.details;
  if (!details) return [];
  if (Array.isArray(details.items)) return details.items.map((it) => it.dishName || `#${it.dishId}`).filter(Boolean);
  if (Array.isArray(details.dishNames)) return details.dishNames;
  if (details.dishName) return [details.dishName];
  return [];
}
