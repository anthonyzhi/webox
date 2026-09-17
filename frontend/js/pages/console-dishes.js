/* pages/console-dishes.js — admin dish catalog: server-side table + create/edit editor. */

import { api, ApiError, normalizePage, isAbort, getEnums } from '../api.js';
import {
  ALLERGENS, CATEGORIES, SPICE_LEVELS, LIMITS, escapeHtml, formatCents, debounce, icon,
  centsToInputValue, parsePriceToCents, isRepeatClick, skeletonLines, emptyStateHtml,
  errorStateHtml, toast, toastSuccess, setFieldError, clearFieldErrors, openModal,
  pagerHtml, wirePager, imageUrlOr, spiceLabel, truncate, pluralize,
} from '../utils.js';

const state = {
  q: '',
  category: '',
  active: '',
  page: 0,
  size: 10,
  items: [],
  totalElements: 0,
  totalPages: 1,
};

let dom = {};
let enums = {
  categories: CATEGORIES,
  spiceLevels: SPICE_LEVELS,
  allergens: ALLERGENS,
};

export async function renderConsoleDishes(root) {
  root.innerHTML = `<section class="page">
    <header class="page-head">
      <div>
        <h1>Dishes</h1>
        <p class="page-sub">Create, edit and shelve the dishes employees can order.</p>
      </div>
      <div class="page-head-actions">
        <button type="button" class="btn btn-primary" data-new>${icon('plus')}<span>New dish</span></button>
      </div>
    </header>

    <div class="card filters-bar">
      <div class="search">
        <span class="search-icon" aria-hidden="true">${icon('search')}</span>
        <label class="sr-only" for="dish-q">Search dishes</label>
        <input class="input" id="dish-q" type="search" maxlength="${LIMITS.search}" placeholder="Search dishes…"
               value="${escapeHtml(state.q)}" autocomplete="off">
        <button type="button" class="input-icon" data-clear-search aria-label="Clear search" hidden>${icon('close')}</button>
      </div>
      <span class="select-wrap">
        <label class="sr-only" for="dish-category">Category</label>
        <select class="select" id="dish-category">
          <option value="">All categories</option>
          ${enums.categories.map((c) => `<option value="${escapeHtml(c)}" ${state.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </span>
      <span class="select-wrap">
        <label class="sr-only" for="dish-status">Status</label>
        <select class="select" id="dish-status">
          <option value="">Any status</option>
          <option value="true" ${state.active === 'true' ? 'selected' : ''}>On the menu</option>
          <option value="false" ${state.active === 'false' ? 'selected' : ''}>Off the menu</option>
        </select>
      </span>
      <p class="help mb-0" data-role="count" aria-live="polite"></p>
    </div>

    <div class="card" data-role="table-card">
      <div class="table-wrap" data-role="table">${skeletonLines(4)}</div>
    </div>
    <nav class="pager" data-role="pager" aria-label="Dish pages"></nav>
  </section>`;

  dom = {
    table: root.querySelector('[data-role="table"]'),
    pager: root.querySelector('[data-role="pager"]'),
    count: root.querySelector('[data-role="count"]'),
    search: root.querySelector('#dish-q'),
    category: root.querySelector('#dish-category'),
    status: root.querySelector('#dish-status'),
  };

  try {
    const meta = await getEnums();
    if (meta?.categories?.length) enums = { ...enums, ...meta };
  } catch (err) { /* enum fallbacks already in place */ }

  const runSearch = debounce(() => { state.page = 0; load(); }, 300);
  const clearSearch = root.querySelector('[data-clear-search]');
  const syncClear = () => { clearSearch.hidden = !dom.search.value; };
  syncClear();
  dom.search.addEventListener('input', () => {
    state.q = dom.search.value.slice(0, LIMITS.search);
    syncClear();
    runSearch();
  });
  clearSearch.addEventListener('click', () => {
    dom.search.value = '';
    state.q = '';
    state.page = 0;
    syncClear();
    runSearch.cancel();
    load();
    dom.search.focus();
  });
  dom.category.addEventListener('change', () => { state.category = dom.category.value; state.page = 0; load(); });
  dom.status.addEventListener('change', () => { state.active = dom.status.value; state.page = 0; load(); });

  root.querySelector('[data-new]').addEventListener('click', async () => {
    const created = await openDishEditor(null);
    if (created) load();
  });

  wirePager(dom.pager, (page) => {
    state.page = page;
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  dom.table.addEventListener('click', onTableClick);
  dom.table.addEventListener('change', onTableChange);

  load();
  return () => { dom = {}; };
}

/* ------------------------------------------------------------------ table */

async function load() {
  if (!dom.table) return;
  dom.table.innerHTML = skeletonLines(4);
  dom.pager.innerHTML = '';
  try {
    const activeParam = state.active === '' ? null : state.active;
    const data = await api.get('/admin/dishes', {
      query: {
        q: state.q || null,
        category: state.category || null,
        active: activeParam,
        page: state.page,
        size: state.size,
      },
    });
    const page = normalizePage(data);
    state.page = page.page;
    state.items = page.items;
    state.totalElements = page.totalElements;
    state.totalPages = Math.max(1, page.totalPages);
    renderTable();
    const from = page.totalElements ? page.page * page.size + 1 : 0;
    const to = Math.min(page.totalElements, (page.page + 1) * page.size);
    dom.pager.innerHTML = pagerHtml({
      page: page.page,
      totalPages: page.totalPages,
      info: page.totalElements ? `Showing ${from}–${to} of ${page.totalElements} dishes` : 'No dishes found',
    });
    dom.count.textContent = `${page.totalElements} ${page.totalElements === 1 ? 'dish' : 'dishes'}`;
  } catch (err) {
    if (isAbort(err)) return;
    dom.table.innerHTML = errorStateHtml({
      title: 'Could not load dishes',
      message: err?.message || 'Please try again.',
      retryAttrs: 'data-retry-dishes',
    });
    dom.table.querySelector('[data-retry-dishes]')?.addEventListener('click', () => load());
  }
}

function renderTable() {
  if (!state.items.length) {
    dom.table.innerHTML = emptyStateHtml({
      title: state.q || state.category ? 'No dishes match' : 'No dishes yet',
      message: state.q || state.category
        ? 'Try a different keyword, category or status.'
        : 'Create your first dish to start building daily menus.',
      actionLabel: 'New dish',
      actionAttrs: 'data-new-inline',
      iconName: 'dish',
    });
    dom.table.querySelector('[data-new-inline]')?.addEventListener('click', async () => {
      const created = await openDishEditor(null);
      if (created) load();
    });
    return;
  }

  dom.table.innerHTML = `<table class="data-table">
    <thead>
      <tr>
        <th scope="col">Dish</th>
        <th scope="col">Category</th>
        <th scope="col">Price</th>
        <th scope="col">Allergens</th>
        <th scope="col">Spice</th>
        <th scope="col">On menu</th>
        <th scope="col" class="right">Actions</th>
      </tr>
    </thead>
    <tbody>
      ${state.items.map(rowHtml).join('')}
    </tbody>
  </table>`;
}

function rowHtml(dish) {
  const allergens = Array.isArray(dish.allergens) && dish.allergens.length
    ? dish.allergens.map((a) => `<span class="tag tag-muted">${escapeHtml(a)}</span>`).join(' ')
    : '<span class="muted">—</span>';
  const groupCount = (dish.optionGroups || []).length;
  return `<tr data-dish-id="${escapeHtml(dish.id)}">
    <td class="cell-main" data-label="Dish">
      <span class="cell-name">
        <img class="thumb" src="${escapeHtml(imageUrlOr(dish.imageUrl, Number(dish.id) || 1))}" alt="" loading="lazy" width="46" height="46">
        <span>
          <span class="name">${escapeHtml(dish.name)}</span>
          <span class="cell-sub">${escapeHtml(truncate(dish.description || '', 80))}${groupCount ? ` · ${escapeHtml(pluralize(groupCount, 'option group'))}` : ''}</span>
        </span>
      </span>
    </td>
    <td data-label="Category">${escapeHtml(dish.category || '—')}</td>
    <td data-label="Price">${escapeHtml(formatCents(dish.priceCents))}</td>
    <td data-label="Allergens">${allergens}</td>
    <td data-label="Spice">${escapeHtml(spiceLabel(dish.spiceLevel))}</td>
    <td data-label="On menu">
      <label class="switch">
        <input type="checkbox" data-toggle="${escapeHtml(dish.id)}" ${dish.active ? 'checked' : ''}
               aria-label="Show ${escapeHtml(dish.name)} on the menu">
        <span class="track" aria-hidden="true"></span>
      </label>
    </td>
    <td data-label="Actions" class="right">
      <span class="table-actions">
        <button type="button" class="btn btn-sm btn-outline" data-edit="${escapeHtml(dish.id)}">Edit</button>
      </span>
    </td>
  </tr>`;
}

function onTableClick(event) {
  const btn = event.target.closest('[data-edit]');
  if (!btn || isRepeatClick(btn, 400)) return;
  const dish = state.items.find((d) => String(d.id) === String(btn.dataset.edit));
  if (!dish) return;
  openDishEditor(dish).then((saved) => { if (saved) load(); });
}

async function onTableChange(event) {
  const toggle = event.target.closest('[data-toggle]');
  if (!toggle) return;
  const id = toggle.dataset.toggle;
  const active = toggle.checked;
  toggle.disabled = true;
  try {
    await api.patch(`/admin/dishes/${encodeURIComponent(id)}/status`, { active });
    toastSuccess(active ? 'Dish is back on the menu.' : 'Dish removed from the menu.');
  } catch (err) {
    toggle.checked = !active;
    toast(err?.message || 'Could not update the dish status.', { type: 'error' });
  } finally {
    toggle.disabled = false;
  }
}

/* ----------------------------------------------------------------- editor */

function optionRowsHtml(options = []) {
  return options.map((option) => `<div class="opt-row" data-option-row>
    <input class="input" data-opt="name" maxlength="${LIMITS.optionName}" placeholder="Option name"
           value="${escapeHtml(option.name || '')}" aria-label="Option name">
    <input class="input" data-opt="extra" inputmode="decimal" maxlength="10" placeholder="+0.00"
           value="${escapeHtml(centsToInputValue(option.extraPriceCents || 0))}" aria-label="Extra price in yuan">
    <button type="button" class="btn-icon" data-remove-option aria-label="Remove option">${icon('trash')}</button>
  </div>`).join('');
}

function groupHtml(group = {}) {
  return `<div class="opt-group-editor" data-group-row>
    <div class="og-head">
      <input class="input grow" data-og="name" maxlength="${LIMITS.groupName}" placeholder="Group name, e.g. Bun"
             value="${escapeHtml(group.name || '')}" aria-label="Option group name">
      <label class="checkbox"><input type="checkbox" data-og="required" ${group.required ? 'checked' : ''}> <span>Required</span></label>
      <label class="checkbox"><input type="checkbox" data-og="multiSelect" ${group.multiSelect ? 'checked' : ''}> <span>Multi-select</span></label>
      <button type="button" class="btn btn-sm btn-danger-ghost" data-remove-group>Remove group</button>
    </div>
    <div class="stack-sm" data-og-options>${optionRowsHtml(group.options || [])}</div>
    <div><button type="button" class="btn btn-sm btn-outline" data-add-option>${icon('plus')}<span>Add option</span></button></div>
  </div>`;
}

function editorBody(dish) {
  const isEdit = Boolean(dish);
  const data = dish || {
    name: '', description: '', priceCents: 0, category: enums.categories[0] || 'Chinese',
    protein: '', allergens: [], spiceLevel: 'None', imageUrl: '', active: true, optionGroups: [],
  };

  return `<form class="stack" data-dish-form novalidate>
    <div class="grid-2">
      <div class="field">
        <label class="label" for="dish-name">Name <span class="req-star">*</span></label>
        <input class="input" id="dish-name" name="name" maxlength="${LIMITS.dishName}" value="${escapeHtml(data.name || '')}" required>
        <p class="field-error" data-error-for="name" role="alert"></p>
      </div>
      <div class="field">
        <label class="label" for="dish-price">Price (¥) <span class="req-star">*</span></label>
        <div class="money-input">
          <span class="prefix">¥</span>
          <input class="input" id="dish-price" name="price" inputmode="decimal" maxlength="10"
                 value="${escapeHtml(centsToInputValue(data.priceCents || 0))}" required>
        </div>
        <p class="field-error" data-error-for="priceCents" role="alert"></p>
      </div>
    </div>

    <div class="field">
      <label class="label" for="dish-description">Description <span class="req-star">*</span></label>
      <textarea class="textarea" id="dish-description" name="description" maxlength="${LIMITS.dishDescription}" required>${escapeHtml(data.description || '')}</textarea>
      <p class="field-error" data-error-for="description" role="alert"></p>
    </div>

    <div class="grid-3">
      <div class="field">
        <label class="label" for="dish-cat">Category <span class="req-star">*</span></label>
        <span class="select-wrap">
          <select class="select" id="dish-cat" name="category">
            ${enums.categories.map((c) => `<option value="${escapeHtml(c)}" ${data.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </span>
      </div>
      <div class="field">
        <label class="label" for="dish-protein">Protein source</label>
        <input class="input" id="dish-protein" name="protein" maxlength="${LIMITS.protein}" value="${escapeHtml(data.protein || '')}" placeholder="Chicken">
        <p class="field-error" data-error-for="protein" role="alert"></p>
      </div>
      <div class="field">
        <label class="label" for="dish-spice">Spice level</label>
        <span class="select-wrap">
          <select class="select" id="dish-spice" name="spiceLevel">
            ${enums.spiceLevels.map((s) => `<option value="${escapeHtml(s)}" ${data.spiceLevel === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </span>
      </div>
    </div>

    <fieldset class="opt-group">
      <legend>Allergens</legend>
      <div class="checkbox-grid">
        ${enums.allergens.map((a) => `<label class="checkbox">
          <input type="checkbox" name="allergens" value="${escapeHtml(a)}" ${(data.allergens || []).includes(a) ? 'checked' : ''}>
          <span>${escapeHtml(a)}</span>
        </label>`).join('')}
      </div>
    </fieldset>

    <div class="grid-2">
      <div class="upload-zone">
        <span class="label">Dish photo</span>
        <div class="upload-preview">
          <img data-role="preview" src="${escapeHtml(imageUrlOr(data.imageUrl, Number(data.id) || 1))}" alt="Dish preview" width="84" height="84">
          <div class="stack-sm">
            <label class="btn btn-outline btn-sm">
              ${icon('upload')}<span>Upload image</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" data-role="file" class="sr-only">
            </label>
            <p class="help mb-0">JPEG, PNG or WebP · up to 5 MB.</p>
            <p class="field-error" data-error-for="imageUrl" role="alert"></p>
          </div>
        </div>
        <div class="field mb-0">
          <label class="label" for="dish-image-url">Image URL</label>
          <input class="input" id="dish-image-url" name="imageUrl" maxlength="${LIMITS.imageUrl}"
                 value="${escapeHtml(data.imageUrl || '')}" placeholder="/uploads/dish.jpg">
        </div>
      </div>

      <div class="stack-sm">
        <span class="label">Availability</span>
        <label class="switch">
          <input type="checkbox" name="active" ${data.active ? 'checked' : ''}>
          <span class="track" aria-hidden="true"></span>
          <span>Show this dish on the daily menu</span>
        </label>
        <p class="help">Inactive dishes disappear from the employee menu. You still choose per-day quantities in Daily menu.</p>
      </div>
    </div>

    <fieldset class="opt-group">
      <legend>Option groups</legend>
      <p class="opt-hint">Optional extras such as bun type or side dishes. Add a ¥ amount for paid extras.</p>
      <div class="opt-editor" data-role="groups">
        ${(data.optionGroups || []).map(groupHtml).join('')}
      </div>
      <div class="mt-3"><button type="button" class="btn btn-sm btn-outline" data-add-group>${icon('plus')}<span>Add option group</span></button></div>
    </fieldset>
  </form>`;
}

function openDishEditor(dish) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    const modal = openModal({
      title: dish ? `Edit “${dish.name}”` : 'New dish',
      body: editorBody(dish),
      size: 'lg',
      actions: [
        { label: 'Cancel', variant: 'outline', onClick: () => finish(false) },
        {
          label: dish ? 'Save changes' : 'Create dish',
          variant: 'primary',
          keepOpen: true,
          testid: 'save-dish',
          onClick: ({ bodyEl, close }) => {
            submit(bodyEl).then((ok) => { if (ok) { close(true); finish(true); } });
          },
        },
      ],
      onMount: ({ setOnClose }) => setOnClose(() => finish(false)),
    });

    const form = modal.bodyEl.querySelector('[data-dish-form]');
    const groupsHost = form.querySelector('[data-role="groups"]');
    const fileInput = form.querySelector('[data-role="file"]');
    const preview = form.querySelector('[data-role="preview"]');
    const imageUrlInput = form.querySelector('#dish-image-url');
    const saveBtn = modal.root.querySelector('[data-testid="save-dish"]');

    /* option-group editor */
    form.querySelector('[data-add-group]').addEventListener('click', () => {
      groupsHost.insertAdjacentHTML('beforeend', groupHtml({ required: false, multiSelect: false, options: [{ name: '' }] }));
    });
    groupsHost.addEventListener('click', (event) => {
      const removeGroup = event.target.closest('[data-remove-group]');
      if (removeGroup) {
        removeGroup.closest('[data-group-row]').remove();
        return;
      }
      const addOption = event.target.closest('[data-add-option]');
      if (addOption) {
        addOption.closest('[data-group-row]').querySelector('[data-og-options]')
          .insertAdjacentHTML('beforeend', optionRowsHtml([{ name: '', extraPriceCents: 0 }]));
        return;
      }
      const removeOption = event.target.closest('[data-remove-option]');
      if (removeOption) removeOption.closest('[data-option-row]').remove();
    });

    /* upload */
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        setFieldError(form, 'imageUrl', 'Only JPEG, PNG or WebP images are allowed.');
        fileInput.value = '';
        return;
      }
      if (file.size > LIMITS.uploadBytes) {
        setFieldError(form, 'imageUrl', 'Images must be 5 MB or smaller.');
        fileInput.value = '';
        return;
      }
      setFieldError(form, 'imageUrl', '');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Uploading…</span>';
      try {
        const result = await api.upload('/admin/uploads', file);
        if (result?.url) {
          imageUrlInput.value = result.url;
          preview.src = result.url;
          toastSuccess('Image uploaded.');
        } else {
          setFieldError(form, 'imageUrl', 'The upload did not return an image URL.');
        }
      } catch (err) {
        setFieldError(form, 'imageUrl', err?.message || 'Upload failed.');
        toast(err?.message || 'Upload failed.', { type: 'error' });
      } finally {
        fileInput.value = '';
        saveBtn.disabled = false;
        saveBtn.textContent = dish ? 'Save changes' : 'Create dish';
      }
    });

    imageUrlInput.addEventListener('input', () => {
      const value = imageUrlInput.value.trim();
      if (value) preview.src = value;
      setFieldError(form, 'imageUrl', '');
    });

    async function submit(bodyEl) {
      const currentForm = bodyEl.querySelector('[data-dish-form]');
      if (!currentForm) return false;
      clearFieldErrors(currentForm);

      // NOTE: read controls through querySelector — `form.name` would shadow the
      // built-in HTMLFormElement.name property.
      const name = fieldValue(currentForm, 'name').trim();
      const description = fieldValue(currentForm, 'description').trim();
      const priceCents = parsePriceToCents(fieldValue(currentForm, 'price'));
      const protein = fieldValue(currentForm, 'protein').trim();
      const imageUrl = fieldValue(currentForm, 'imageUrl').trim();
      const allergens = Array.from(currentForm.querySelectorAll('input[name="allergens"]:checked')).map((i) => i.value);
      const optionGroups = collectGroups(currentForm);

      let invalid = false;
      if (!name) { setFieldError(currentForm, 'name', 'Name is required.'); invalid = true; }
      else if (name.length > LIMITS.dishName) { setFieldError(currentForm, 'name', `Name must be at most ${LIMITS.dishName} characters.`); invalid = true; }
      if (!description) { setFieldError(currentForm, 'description', 'Description is required.'); invalid = true; }
      if (priceCents === null || priceCents < 0 || priceCents > 100000) {
        setFieldError(currentForm, 'priceCents', 'Enter a price between ¥0.00 and ¥1000.00.');
        invalid = true;
      }
      if (imageUrl.length > LIMITS.imageUrl) { setFieldError(currentForm, 'imageUrl', `Image URL must be at most ${LIMITS.imageUrl} characters.`); invalid = true; }
      for (const group of optionGroups) {
        if (!group.name) { toast('Every option group needs a name.', { type: 'warn' }); invalid = true; break; }
        if (group.options.some((o) => !o.name)) { toast(`Add a name for every option in “${group.name}”.`, { type: 'warn' }); invalid = true; break; }
      }
      if (invalid) return false;

      const payload = {
        name,
        description,
        priceCents,
        category: fieldValue(currentForm, 'category'),
        protein,
        allergens,
        spiceLevel: fieldValue(currentForm, 'spiceLevel'),
        imageUrl,
        active: Boolean(currentForm.querySelector('input[name="active"]')?.checked),
        optionGroups,
      };

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Saving…</span>';
      try {
        if (dish?.id) await api.put(`/admin/dishes/${encodeURIComponent(dish.id)}`, payload);
        else await api.post('/admin/dishes', payload);
        toastSuccess(dish ? 'Dish updated.' : 'Dish created.');
        return true;
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = dish ? 'Save changes' : 'Create dish';
        handleDishError(err, currentForm);
        return false;
      }
    }
  });
}

/** Read a named control without depending on `form.<name>` named access. */
function fieldValue(form, name) {
  const control = form.querySelector(`[name="${name}"]`);
  if (!control) return '';
  return String(control.value ?? '');
}

function collectGroups(form) {
  return Array.from(form.querySelectorAll('[data-group-row]')).map((row, groupIndex) => ({
    name: row.querySelector('[data-og="name"]').value.trim(),
    required: row.querySelector('[data-og="required"]').checked,
    multiSelect: row.querySelector('[data-og="multiSelect"]').checked,
    sortOrder: groupIndex,
    options: Array.from(row.querySelectorAll('[data-option-row]')).map((optionRow, optionIndex) => ({
      name: optionRow.querySelector('[data-opt="name"]').value.trim(),
      extraPriceCents: parsePriceToCents(optionRow.querySelector('[data-opt="extra"]').value) ?? 0,
      sortOrder: optionIndex,
    })),
  })).filter((group) => group.name || group.options.length);
}

function handleDishError(err, form) {
  if (!(err instanceof ApiError)) {
    toast('Could not save the dish. Please try again.', { type: 'error' });
    return;
  }
  if (err.code === 'DISH_NAME_TAKEN') {
    setFieldError(form, 'name', err.message || 'A dish with that name already exists.');
    toast(err.message || 'A dish with that name already exists.', { type: 'error' });
    return;
  }
  if (err.code === 'DUPLICATE_OPTION_NAME') {
    toast(err.message || 'Each option inside a group needs a unique name.', { type: 'error', title: 'Duplicate option' });
    return;
  }
  if (err.fieldErrors) {
    Object.entries(err.fieldErrors).forEach(([field, message]) => setFieldError(form, field, message));
    toast(err.message || 'Please fix the highlighted fields.', { type: 'error' });
    return;
  }
  toast(err.message || 'Could not save the dish.', { type: 'error' });
}
