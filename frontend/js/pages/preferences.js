/* pages/preferences.js — dietary preferences that drive recommendations + allergen warnings. */

import { api, ApiError, isAbort, getEnums } from '../api.js';
import { getPreferences, setPreferences } from '../store.js';
import {
  ALLERGENS, CATEGORIES, SPICE_LEVELS, TASTES, escapeHtml, centsToInputValue,
  parsePriceToCents, validateBudgets, setFieldError, clearFieldErrors, setBusy, toast,
  toastSuccess, skeletonLines, errorStateHtml, icon,
} from '../utils.js';

export async function renderPreferencesPage(root) {
  root.innerHTML = `<section class="page">
    <header class="page-head">
      <div>
        <h1>Dietary preferences</h1>
        <p class="page-sub">We use these to warn you about allergens and to rank dishes that suit you.</p>
      </div>
    </header>
    <div data-role="body">${skeletonLines(6)}</div>
  </section>`;

  const body = root.querySelector('[data-role="body"]');
  let enums = null;
  let preferences = getPreferences();

  try {
    const [enumsData, remote] = await Promise.all([
      getEnums().catch(() => null),
      api.get('/me/preferences'),
    ]);
    enums = enumsData;
    if (remote) preferences = remote;
    setPreferences(preferences);
  } catch (err) {
    if (isAbort(err)) return () => {};
    body.innerHTML = errorStateHtml({
      title: 'Preferences unavailable',
      message: err?.message || 'Could not load your preferences.',
      retryAttrs: 'data-retry-prefs',
    });
    body.querySelector('[data-retry-prefs]')?.addEventListener('click', () => renderPreferencesPage(root));
    return () => {};
  }

  const allergenList = enums?.allergens?.length ? enums.allergens : ALLERGENS;
  const cuisineList = enums?.categories?.length ? enums.categories : CATEGORIES;
  const spiceList = enums?.spiceLevels?.length ? enums.spiceLevels : SPICE_LEVELS;
  const tasteList = enums?.tastes?.length ? enums.tastes : TASTES;

  const selectedAllergens = new Set(preferences.allergens || []);
  const selectedCuisines = new Set(preferences.cuisinePreferences || []);

  body.innerHTML = `<form class="stack" data-form novalidate>
    <div class="grid-2">
      <div class="card card-pad">
        <h2>Allergens to avoid</h2>
        <p class="help">Dishes containing these get a warning before you add them — they are never hidden from the menu.</p>
        <div class="checkbox-grid" role="group" aria-label="Allergens to avoid">
          ${allergenList.map((allergen) => `<label class="checkbox">
            <input type="checkbox" name="allergens" value="${escapeHtml(allergen)}"
              ${selectedAllergens.has(allergen) ? 'checked' : ''}>
            <span>${escapeHtml(allergen)}</span>
          </label>`).join('')}
        </div>
      </div>

      <div class="card card-pad">
        <h2>Preferred cuisines</h2>
        <p class="help">Cuisines we should surface first when “Recommend for me” is on.</p>
        <div class="checkbox-grid" role="group" aria-label="Preferred cuisines">
          ${cuisineList.map((cuisine) => `<label class="checkbox">
            <input type="checkbox" name="cuisinePreferences" value="${escapeHtml(cuisine)}"
              ${selectedCuisines.has(cuisine) ? 'checked' : ''}>
            <span>${escapeHtml(cuisine)}</span>
          </label>`).join('')}
        </div>
      </div>
    </div>

    <div class="card card-pad">
      <h2>Taste profile</h2>
      <div class="grid-3">
        <div class="field">
          <label class="label" for="pref-spice">Spice level</label>
          <span class="select-wrap">
            <select class="select" id="pref-spice" name="spiceLevel">
              <option value="">No preference</option>
              ${spiceList.map((level) => `<option value="${escapeHtml(level)}" ${preferences.spiceLevel === level ? 'selected' : ''}>${escapeHtml(level)}</option>`).join('')}
            </select>
          </span>
        </div>
        <div class="field">
          <label class="label" for="pref-taste">Taste</label>
          <span class="select-wrap">
            <select class="select" id="pref-taste" name="taste">
              <option value="">No preference</option>
              ${tasteList.map((taste) => `<option value="${escapeHtml(taste)}" ${preferences.taste === taste ? 'selected' : ''}>${escapeHtml(taste)}</option>`).join('')}
            </select>
          </span>
        </div>
        <div class="field">
          <span class="label">Recommendations</span>
          <label class="switch">
            <input type="checkbox" name="recommendEnabled" ${preferences.recommendEnabled ? 'checked' : ''}>
            <span class="track" aria-hidden="true"></span>
            <span>Recommend for me</span>
          </label>
          <p class="help">Highlights dishes that match your preferences on the menu page.</p>
        </div>
      </div>

      <h3 class="mt-4">Per-meal budget</h3>
      <p class="help">We warn you at checkout when an order goes above the maximum. Leave blank for no budget.</p>
      <div class="grid-2">
        <div class="field">
          <label class="label" for="pref-budget-min">Minimum (¥)</label>
          <div class="money-input">
            <span class="prefix">¥</span>
            <input class="input" id="pref-budget-min" name="budgetMin" type="text" inputmode="decimal"
                   maxlength="10" placeholder="0.00" value="${escapeHtml(centsToInputValue(preferences.budgetMinCents))}">
          </div>
          <p class="field-error" data-error-for="budgetMinCents" role="alert"></p>
        </div>
        <div class="field">
          <label class="label" for="pref-budget-max">Maximum (¥)</label>
          <div class="money-input">
            <span class="prefix">¥</span>
            <input class="input" id="pref-budget-max" name="budgetMax" type="text" inputmode="decimal"
                   maxlength="10" placeholder="30.00" value="${escapeHtml(centsToInputValue(preferences.budgetMaxCents))}">
          </div>
          <p class="field-error" data-error-for="budgetMaxCents" role="alert"></p>
        </div>
      </div>
    </div>

    <div class="spread">
      <p class="help mb-0">Preference changes apply to the menu immediately after saving.</p>
      <div class="row">
        <button type="button" class="btn btn-ghost" data-reset>Reset form</button>
        <button type="submit" class="btn btn-primary btn-lg" data-submit>${icon('check')}<span>Save preferences</span></button>
      </div>
    </div>
  </form>`;

  const form = body.querySelector('[data-form]');
  const submit = body.querySelector('[data-submit]');

  form.querySelector('[data-reset]').addEventListener('click', () => renderPreferencesPage(root));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const allergens = Array.from(form.querySelectorAll('input[name="allergens"]:checked')).map((i) => i.value);
    const cuisinePreferences = Array.from(form.querySelectorAll('input[name="cuisinePreferences"]:checked')).map((i) => i.value);
    const spiceLevel = form.spiceLevel.value || null;
    const taste = form.taste.value || null;
    const recommendEnabled = form.recommendEnabled.checked;

    const minRaw = form.budgetMin.value.trim();
    const maxRaw = form.budgetMax.value.trim();
    const budgetMinCents = minRaw === '' ? null : parsePriceToCents(minRaw);
    const budgetMaxCents = maxRaw === '' ? null : parsePriceToCents(maxRaw);

    let invalid = false;
    if (minRaw !== '' && budgetMinCents === null) {
      setFieldError(form, 'budgetMinCents', 'Enter an amount like 15 or 15.50.');
      invalid = true;
    }
    if (maxRaw !== '' && budgetMaxCents === null) {
      setFieldError(form, 'budgetMaxCents', 'Enter an amount like 30 or 30.00.');
      invalid = true;
    }
    if (!invalid) {
      const budgetErrors = validateBudgets(budgetMinCents, budgetMaxCents);
      Object.entries(budgetErrors).forEach(([field, message]) => {
        setFieldError(form, field, message);
        invalid = true;
      });
    }
    if (invalid) {
      toast('Please fix the highlighted fields.', { type: 'warn' });
      return;
    }

    const payload = {
      allergens, cuisinePreferences, spiceLevel, taste, budgetMinCents, budgetMaxCents, recommendEnabled,
    };

    setBusy(submit, true, 'Saving…');
    try {
      const updated = await api.put('/me/preferences', payload);
      setPreferences(updated || payload);
      toastSuccess('Preferences saved. The menu now reflects your choices.');
    } catch (err) {
      if (isAbort(err)) return;
      if (err instanceof ApiError && err.fieldErrors) {
        Object.entries(err.fieldErrors).forEach(([field, message]) => {
          if (field === 'budgetMinCents' || field === 'budgetMaxCents') setFieldError(form, field, message);
          else toast(`${field}: ${message}`, { type: 'error' });
        });
        toast(err.message || 'Please fix the highlighted fields.', { type: 'error' });
      } else {
        toast(err?.message || 'Could not save your preferences.', { type: 'error' });
      }
    } finally {
      setBusy(submit, false);
    }
  });

  return () => {};
}
