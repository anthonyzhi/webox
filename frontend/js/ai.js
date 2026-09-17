/* ai.js — AI meal assistant panel + SSE client for /api/ai/recommend. */

import { api } from './api.js';
import {
  closeAiPanel, addToCartFlow, cartServings, maxQuantityPerOrder, dishHasOptions, openCart,
} from './store.js';
import {
  LIMITS, escapeHtml, formatCents, formatStreamText, icon, isRepeatClick, stockView,
  spiceLabel, toastError, toastSuccess, validatePrompt, imageUrlOr, truncate, todayStr,
} from './utils.js';
import { navigate } from './router.js';

const EXAMPLES = [
  'I want something light today',
  'A high-protein low-fat lunch',
  'Nothing I ate yesterday',
];

const state = { streaming: false, source: null, timeout: null, results: [], done: false };

let dom = {};

export function initAiPanel(panel) {
  panel.innerHTML = `
    <div class="drawer-head">
      <h2>${icon('sparkles')} AI meal assistant</h2>
      <button type="button" class="btn-icon" data-close aria-label="Close AI assistant">${icon('close')}</button>
    </div>
    <div class="ai-body">
      <div class="field">
        <label class="label" for="ai-prompt">What are you in the mood for?</label>
        <textarea class="textarea ai-prompt" id="ai-prompt" maxlength="${LIMITS.prompt}"
          placeholder="Tell us what you feel like eating today…"></textarea>
        <p class="help"><span data-role="counter">0</span> / ${LIMITS.prompt} characters</p>
        <p class="field-error" data-role="error" role="alert"></p>
      </div>
      <div class="chips" data-role="examples" role="group" aria-label="Example prompts">
        ${EXAMPLES.map((example) => `<button type="button" class="chip" data-example="${escapeHtml(example)}">${escapeHtml(example)}</button>`).join('')}
      </div>
      <div class="row">
        <button type="button" class="btn btn-primary grow" data-send>${icon('sparkles')}<span>Get suggestions</span></button>
        <button type="button" class="btn btn-ghost" data-clear hidden>Clear</button>
      </div>
      <p class="help mb-0" data-role="status" aria-live="polite"></p>
      <pre class="ai-stream" data-role="stream" hidden></pre>
      <div class="stack-sm" data-role="results"></div>
      <p class="help mb-0">Suggestions skip dishes with your flagged allergens and anything you ordered in the last 7 days.</p>
    </div>`;

  dom = {
    panel,
    prompt: panel.querySelector('#ai-prompt'),
    counter: panel.querySelector('[data-role="counter"]'),
    error: panel.querySelector('[data-role="error"]'),
    status: panel.querySelector('[data-role="status"]'),
    stream: panel.querySelector('[data-role="stream"]'),
    results: panel.querySelector('[data-role="results"]'),
    send: panel.querySelector('[data-send]'),
    clear: panel.querySelector('[data-clear]'),
    examples: panel.querySelector('[data-role="examples"]'),
  };

  panel.querySelector('[data-close]').addEventListener('click', () => closeAiPanel());

  dom.prompt.addEventListener('input', () => {
    const value = dom.prompt.value.slice(0, LIMITS.prompt);
    if (dom.prompt.value !== value) dom.prompt.value = value;
    dom.counter.textContent = String(value.length);
    dom.error.textContent = '';
  });

  dom.examples.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-example]');
    if (!chip) return;
    dom.prompt.value = chip.dataset.example;
    dom.counter.textContent = String(dom.prompt.value.length);
    dom.prompt.focus();
  });

  dom.send.addEventListener('click', () => {
    if (isRepeatClick(dom.send, 400)) return;
    ask();
  });

  dom.clear.addEventListener('click', () => {
    dom.prompt.value = '';
    dom.counter.textContent = '0';
    reset();
    dom.prompt.focus();
  });

  dom.results.addEventListener('click', onResultClick);

  dom.prompt.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      ask();
    }
  });

  reset();
}

export function closeAiStream() {
  if (state.source) {
    try { state.source.close(); } catch (err) { /* noop */ }
    state.source = null;
  }
  if (state.timeout) { clearTimeout(state.timeout); state.timeout = null; }
  state.streaming = false;
}

function reset() {
  closeAiStream();
  state.results = [];
  state.done = false;
  state.payloadError = false;
  state.streamBuffer = '';
  if (dom.error) dom.error.textContent = '';
  if (dom.stream) { dom.stream.hidden = true; dom.stream.innerHTML = ''; }
  if (dom.results) dom.results.innerHTML = '';
  if (dom.status) dom.status.textContent = '';
  if (dom.clear) dom.clear.hidden = true;
}

/* ------------------------------------------------------------------ ask */

function ask() {
  if (state.streaming) return;
  const prompt = (dom.prompt.value || '').trim();
  const error = validatePrompt(prompt);
  if (error) {
    dom.error.textContent = error;
    dom.prompt.focus();
    return;
  }

  reset();
  state.streaming = true;
  setStatus('Thinking about it…');
  dom.send.disabled = true;
  dom.send.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Asking…</span>';
  state.streamBuffer = '';

  if (typeof window.EventSource !== 'function') {
    setStatus('Live streaming is not supported by this browser.');
    finishStreaming();
    return;
  }

  const url = api.sseUrl('/ai/recommend', { prompt, date: todayStr() });
  let source;
  try {
    source = new EventSource(url);
  } catch (err) {
    setStatus('Could not start the assistant. Please try again.');
    finishStreaming();
    return;
  }
  state.source = source;

  state.timeout = window.setTimeout(() => {
    if (!state.done) {
      setStatus('This is taking longer than expected. Please try again.', true);
      closeAiStream();
      finishStreaming();
    }
  }, 60000);

  source.addEventListener('provider', (event) => {
    const payload = parse(event);
    if (!payload) return;
    if (payload.provider === 'rule-based') {
      appendProvider('Served by on-device matching (rule-based)');
      appendNote('No LLM is configured, so we matched dishes on-device from your preferences. You can still add anything below.');
    } else {
      appendProvider(`Served by ${payload.provider}${payload.model ? ` · ${payload.model}` : ''}`);
    }
  });

  source.addEventListener('candidate', (event) => {
    const payload = parse(event);
    if (!payload) return;
    setStatus(`Scanning ${payload.count} candidate ${payload.count === 1 ? 'dish' : 'dishes'}…`);
  });

  source.addEventListener('delta', (event) => {
    const payload = parse(event);
    if (!payload || !payload.text) return;
    appendDelta(payload.text);
  });

  source.addEventListener('dish', (event) => {
    const payload = parse(event);
    if (!payload || payload.menuId === undefined) return;
    state.results.push({ menuId: payload.menuId, reason: payload.reason || '', item: null, error: null });
    renderResult(state.results.length - 1);
    resolveResult(state.results.length - 1, payload);
  });

  source.addEventListener('done', (event) => {
    const payload = parse(event) || {};
    state.done = true;
    if (Array.isArray(payload.recommendations) && payload.recommendations.length && !state.results.length) {
      payload.recommendations.forEach((rec) => {
        state.results.push({ menuId: rec.menuId, reason: rec.reason || '', item: null, error: null });
        renderResult(state.results.length - 1);
        resolveResult(state.results.length - 1, rec);
      });
    }
    setStatus(state.results.length
      ? `${state.results.length} ${state.results.length === 1 ? 'suggestion' : 'suggestions'} ready.`
      : 'No dishes matched. Try a different description.');
    dom.clear.hidden = false;
    closeAiStream();
    finishStreaming();
  });

  source.addEventListener('error', (event) => {
    // Two different things arrive here: our `event: error` payload, or a transport error.
    const payload = event && event.data ? parse(event) : null;
    if (payload?.message) {
      state.payloadError = true; // the server keeps streaming rule-based suggestions
      appendNote(payload.message, true);
      setStatus('Fell back to on-device matching.', true);
      return;
    }
    if (state.done) return;
    setStatus('The live connection dropped. Please try again.', true);
    closeAiStream();
    finishStreaming();
  });

  source.onerror = () => {
    if (state.done || !state.streaming || state.payloadError) return;
    setStatus('Connection issue. Suggestions may be incomplete — try again.', true);
    closeAiStream();
    finishStreaming();
  };
}

function finishStreaming() {
  state.streaming = false;
  if (state.timeout) { clearTimeout(state.timeout); state.timeout = null; }
  if (dom.send) {
    dom.send.disabled = false;
    dom.send.innerHTML = `${icon('sparkles')}<span>Get suggestions</span>`;
  }
}

function parse(event) {
  try { return JSON.parse(event.data); } catch (err) { return null; }
}

function setStatus(text, warn = false) {
  if (!dom.status) return;
  dom.status.textContent = text || '';
  dom.status.style.color = warn ? 'var(--warn)' : '';
}

function appendProvider(text) {
  if (!dom.status) return;
  dom.status.textContent = text;
}

function appendNote(text, warn = false) {
  if (!dom.results) return;
  const note = document.createElement('p');
  note.className = `help ${warn ? 'strong' : ''}`;
  note.style.color = warn ? 'var(--warn)' : '';
  note.textContent = text;
  note.dataset.role = 'note';
  dom.results.appendChild(note);
}

function appendDelta(text) {
  if (!dom.stream) return;
  state.streamBuffer = `${state.streamBuffer || ''}${text}`;
  dom.stream.hidden = false;
  dom.stream.innerHTML = formatStreamText(state.streamBuffer);
  dom.stream.scrollTop = dom.stream.scrollHeight;
}

/* --------------------------------------------------------------- results */

function renderResult(index) {
  const entry = state.results[index];
  if (!dom.results || !entry) return;
  const el = document.createElement('article');
  el.className = 'ai-card';
  el.dataset.resultIndex = String(index);
  el.innerHTML = `
    <div class="skeleton" style="width:76px;height:76px;border-radius:6px"></div>
    <div>
      <div class="skeleton sk-line" style="width:70%"></div>
      <div class="skeleton sk-line" style="width:45%"></div>
    </div>`;
  dom.results.appendChild(el);
  if (entry.reason) setReason(el, entry.reason);
}

function setReason(el, reason) {
  let slot = el.querySelector('[data-role="reason"]');
  if (!slot) {
    slot = document.createElement('p');
    slot.className = 'ai-card-reason';
    slot.dataset.role = 'reason';
    el.querySelector('div:last-child')?.appendChild(slot);
  }
  slot.textContent = reason;
}

async function resolveResult(index, payload) {
  const entry = state.results[index];
  if (!entry) return;
  let item = payload && payload.name && payload.priceCents !== undefined ? payload : null;

  if (!item) {
    try {
      const response = await api.get(`/menu/items/${encodeURIComponent(entry.menuId)}`);
      item = response?.item || null;
    } catch (err) {
      entry.error = err?.message || 'This dish is no longer available.';
      paintResult(index);
      return;
    }
  }
  entry.item = item;
  if (!entry.reason && item && item.reason) entry.reason = item.reason;
  paintResult(index);
}

function paintResult(index) {
  const entry = state.results[index];
  const card = dom.results?.querySelector(`[data-result-index="${index}"]`);
  if (!entry || !card) return;

  if (entry.error || !entry.item) {
    card.innerHTML = `<div></div><div>
      <div class="strong">${escapeHtml(entry.error || 'Dish unavailable')}</div>
      <p class="help mb-0">It may have been removed from today’s menu.</p>
    </div>`;
    return;
  }

  const item = entry.item;
  const stock = stockView(item);
  const blocked = item.soldOut || (Number.isFinite(Number(item.remaining)) && Number(item.remaining) <= 0);
  const cartFull = cartServings() >= maxQuantityPerOrder();
  const needsOptions = dishHasOptions(item);
  const disabled = blocked || cartFull;
  const label = blocked ? 'Sold out' : cartFull ? `Max ${maxQuantityPerOrder()} servings` : needsOptions ? 'Choose options' : 'Add to cart';

  card.innerHTML = `
    <img src="${escapeHtml(imageUrlOr(item.imageUrl, Number(item.dishId || item.menuId || index + 1)))}"
         alt="${escapeHtml(item.name || 'Dish')}" loading="lazy" width="76" height="76">
    <div>
      <div class="spread">
        <span class="strong">${escapeHtml(truncate(item.name || 'Dish', 60))}</span>
        <span class="price">${escapeHtml(formatCents(item.priceCents))}</span>
      </div>
      <div class="row">
        <span class="tag">${escapeHtml(item.category || 'Dish')}</span>
        ${item.spiceLevel && item.spiceLevel !== 'None' ? `<span class="tag tag-muted">${escapeHtml(spiceLabel(item.spiceLevel))}</span>` : ''}
        ${stock.text ? `<span class="badge badge-stock ${stock.cls}">${escapeHtml(stock.text)}</span>` : ''}
      </div>
      <p class="ai-card-reason" data-role="reason">${escapeHtml(entry.reason || 'Suggested for you.')}</p>
      <button type="button" class="btn btn-primary btn-sm" data-ai-add="${escapeHtml(item.menuId)}"
        ${disabled ? 'disabled' : ''} title="${escapeHtml(blocked ? 'This dish is sold out.' : cartFull ? `Your cart already has ${maxQuantityPerOrder()} servings.` : 'Add to cart')}">
        ${escapeHtml(label)}
      </button>
    </div>`;
}

async function onResultClick(event) {
  const btn = event.target.closest('[data-ai-add]');
  if (!btn || btn.disabled) return;
  if (isRepeatClick(btn, 250)) return;

  const menuId = btn.dataset.aiAdd;
  const entry = state.results.find((r) => String(r.menuId) === String(menuId));
  const item = entry?.item;
  if (!item) return;

  if (dishHasOptions(item)) {
    closeAiPanel();
    navigate(`/dish/${menuId}`);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adding…';
  const result = await addToCartFlow(item, { quantity: 1 });
  if (result.ok) {
    btn.textContent = 'Added ✓';
    toastSuccess(`${item.name} added to your cart.`, { actionLabel: 'Open cart', onAction: openCart, duration: 3000 });
    window.setTimeout(() => { if (btn.isConnected) btn.disabled = true; }, 600);
  } else if (result.code !== 'ALLERGEN_CANCELLED') {
    toastError(result.reason || 'Could not add this dish.');
    btn.disabled = false;
    btn.textContent = 'Add to cart';
  } else {
    btn.disabled = false;
    btn.textContent = 'Add to cart';
  }
}
