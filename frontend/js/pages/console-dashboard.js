/* pages/console-dashboard.js — ops dashboard: overview cards, hand-rolled SVG charts. */

import { api, isAbort } from '../api.js';
import {
  escapeHtml, formatCents, formatTime, formatDateShort, formatWeekday, dayLabel, todayStr,
  debounce, icon, skeletonLines, errorStateHtml, toast, pluralize, isRepeatClick,
} from '../utils.js';

const REFRESH_MS = 30000;

const state = {
  date: todayStr(),
  data: null,
  loading: true,
  refreshing: false,
  lastUpdated: null,
};

let dom = {};
let timer = null;
let resizeObserver = null;
let disposed = false;

export async function renderConsoleDashboard(root) {
  disposed = false;
  state.date = state.date || todayStr();

  root.innerHTML = `<section class="page">
    <header class="page-head">
      <div>
        <h1>Dashboard</h1>
        <p class="page-sub" data-role="sub">Orders and revenue for ${escapeHtml(dayLabel(state.date))}.</p>
      </div>
      <div class="page-head-actions">
        <label class="row small" for="dash-date">
          <span class="muted strong">Date</span>
          <input class="input" id="dash-date" type="date" value="${escapeHtml(state.date)}" max="${escapeHtml(todayStr())}">
        </label>
        <button type="button" class="btn btn-outline" data-refresh>${icon('refresh')}<span>Refresh</span></button>
      </div>
    </header>

    <p class="help" data-role="updated" aria-live="polite"></p>
    <div data-role="body">${skeletonLines(6)}</div>
  </section>`;

  dom = {
    body: root.querySelector('[data-role="body"]'),
    updated: root.querySelector('[data-role="updated"]'),
    sub: root.querySelector('[data-role="sub"]'),
    date: root.querySelector('#dash-date'),
    refresh: root.querySelector('[data-refresh]'),
  };

  dom.date.addEventListener('change', () => {
    state.date = dom.date.value || todayStr();
    state.data = null;
    dom.sub.textContent = `Orders and revenue for ${dayLabel(state.date)}, ${formatDateShort(state.date)}.`;
    refresh({ silent: false });
  });

  dom.refresh.addEventListener('click', () => {
    if (isRepeatClick(dom.refresh, 400)) return;
    refresh({ silent: false });
  });

  document.addEventListener('visibilitychange', onVisibility);
  startTimer();

  await refresh({ silent: false });
  return () => {
    disposed = true;
    stopTimer();
    document.removeEventListener('visibilitychange', onVisibility);
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    dom = {};
  };
}

function onVisibility() {
  if (document.hidden) {
    stopTimer();
  } else if (!disposed) {
    startTimer();
    refresh({ silent: true });
  }
}

function startTimer() {
  stopTimer();
  timer = window.setInterval(() => {
    if (!document.hidden && !disposed) refresh({ silent: true });
  }, REFRESH_MS);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

/* ------------------------------------------------------------------- data */

async function refresh({ silent = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  if (!silent && dom.body) dom.body.innerHTML = skeletonLines(6);
  if (!silent && dom.refresh) {
    dom.refresh.disabled = true;
    dom.refresh.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>Refreshing…</span>`;
  }

  try {
    const data = await api.get('/admin/dashboard', { query: { date: state.date } });
    if (disposed) return;
    state.data = data || {};
    state.loading = false;
    state.lastUpdated = new Date();
    render();
  } catch (err) {
    if (isAbort(err) || disposed) return;
    state.loading = false;
    if (dom.body) {
      dom.body.innerHTML = errorStateHtml({
        title: 'Dashboard unavailable',
        message: err?.message || 'Could not load the dashboard.',
        retryAttrs: 'data-retry-dashboard',
      });
      dom.body.querySelector('[data-retry-dashboard]')?.addEventListener('click', () => refresh({ silent: false }));
    }
    if (!silent) toast(err?.message || 'Could not refresh the dashboard.', { type: 'error' });
  } finally {
    state.refreshing = false;
    if (dom.refresh) {
      dom.refresh.disabled = false;
      dom.refresh.innerHTML = `${icon('refresh')}<span>Refresh</span>`;
    }
    if (dom.updated && state.lastUpdated) {
      dom.updated.textContent = `Auto-refreshing every 30 s · last updated ${formatTime(state.lastUpdated.toISOString())}`;
    }
  }
}

/* --------------------------------------------------------------- rendering */

function render() {
  const data = state.data || {};
  const today = data.today || {};
  const topDishes = Array.isArray(data.topDishes) ? data.topDishes : [];
  const mealPeriod = Array.isArray(data.mealPeriod) ? data.mealPeriod : [];
  const trend = Array.isArray(data.trend) ? data.trend : [];
  const lowStock = Array.isArray(data.lowStock) ? data.lowStock : [];

  dom.body.innerHTML = `
    <div class="stack-lg">
      <div class="stat-grid">
        ${statCard('Orders', String(today.orderCount ?? 0), dayLabel(state.date))}
        ${statCard('Revenue', formatCents(today.totalRevenueCents || 0), 'All statuses')}
        ${statCard('Completed', String(today.completed ?? 0), 'Finished meals', 'badge-ok')}
        ${statCard('Pending', String(today.pending ?? 0), 'Awaiting confirmation', 'badge-warn')}
        ${statCard('Confirmed', String(today.confirmed ?? 0), 'In the kitchen', 'badge-info')}
        ${statCard('Cancelled', String(today.cancelled ?? 0), 'Released stock', 'badge-neutral')}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h2>Top 10 dishes</h2><span class="badge badge-neutral">by servings</span></div>
          <div class="card-body" data-chart="top">
            ${topDishes.length ? '<div class="chart-wrap" data-role="chart-top"></div>' : emptyChart('No dishes were ordered on this date.')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Lunch vs Dinner</h2><span class="badge badge-neutral">orders</span></div>
          <div class="card-body" data-chart="meal">
            ${mealPeriod.length ? '<div class="chart-wrap" data-role="chart-meal"></div>' : emptyChart('No meal-period data yet.')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Last 7 days</h2>
          <div class="chart-legend">
            <span class="chart-legend-item"><span class="swatch swatch-orders"></span>Orders</span>
            <span class="chart-legend-item"><span class="swatch swatch-revenue"></span>Revenue</span>
          </div>
        </div>
        <div class="card-body">
          ${trend.length ? '<div class="chart-wrap" data-role="chart-trend"></div>' : emptyChart('No trend data for the last week.')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Low stock</h2><span class="badge badge-warn">≤ 3 remaining</span></div>
        <div class="card-body">
          ${lowStock.length ? `<div class="low-stock-list">${lowStock.map(lowStockRow).join('')}</div>`
            : '<p class="muted mb-0">Every dish still has four or more servings left.</p>'}
        </div>
      </div>
    </div>`;

  drawCharts();
  observeResize();
}

function statCard(label, value, foot, badgeClass = '') {
  return `<div class="stat-card">
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value">${escapeHtml(value)}</div>
    <div class="stat-foot ${badgeClass ? `badge ${badgeClass}` : ''}">${escapeHtml(foot)}</div>
  </div>`;
}

function emptyChart(message) {
  return `<p class="muted mb-0">${escapeHtml(message)}</p>`;
}

function lowStockRow(item) {
  const remaining = Number(item.remaining) || 0;
  const soldOut = remaining <= 0;
  return `<div class="low-stock-row">
    <span>${escapeHtml(item.dishName || `Dish ${item.menuId}`)}</span>
    <span class="badge badge-stock ${soldOut ? 'is-out' : 'is-low'}">${escapeHtml(soldOut ? 'Sold out' : `Only ${remaining} left`)}</span>
  </div>`;
}

/* ---------------------------------------------------------------- charts */

function observeResize() {
  if (resizeObserver) resizeObserver.disconnect();
  const redraw = debounce(() => { if (widthsChanged()) drawCharts(); }, 200);
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => redraw());
    Object.values(chartsRefs()).forEach((el) => { if (el) resizeObserver.observe(el); });
  } else {
    window.addEventListener('resize', redraw);
  }
}

let lastWidths = { top: 0, meal: 0, trend: 0 };

/** Height changes also fire the observer — only redraw when the width really moved. */
function widthsChanged() {
  const refs = chartsRefs();
  let changed = false;
  ['top', 'meal', 'trend'].forEach((key) => {
    const width = refs[key] ? Math.round(refs[key].clientWidth) : 0;
    if (width && width !== lastWidths[key]) {
      lastWidths[key] = width;
      changed = true;
    }
  });
  return changed;
}

function chartsRefs() {
  return {
    top: dom.body?.querySelector('[data-role="chart-top"]'),
    meal: dom.body?.querySelector('[data-role="chart-meal"]'),
    trend: dom.body?.querySelector('[data-role="chart-trend"]'),
  };
}

function drawCharts() {
  if (!state.data || !dom.body) return;
  const refs = chartsRefs();
  const data = state.data;

  if (refs.top) {
    const width = Math.max(280, Math.round(refs.top.clientWidth || 600));
    lastWidths.top = width;
    refs.top.innerHTML = topDishesChart(data.topDishes || [], width);
  }
  if (refs.meal) {
    const width = Math.max(280, Math.round(refs.meal.clientWidth || 600));
    lastWidths.meal = width;
    refs.meal.innerHTML = mealPeriodChart(data.mealPeriod || [], width);
  }
  if (refs.trend) {
    const width = Math.max(300, Math.round(refs.trend.clientWidth || 600));
    lastWidths.trend = width;
    refs.trend.innerHTML = trendChart(data.trend || [], width);
    wireTrendTooltip(refs.trend, data.trend || []);
  }
}

/** Horizontal bar chart drawn as SVG sized to the container (no scaling blur). */
function topDishesChart(items, width) {
  const top = items.slice(0, 10);
  if (!top.length) return emptyChart('No dishes were ordered on this date.');
  const rowH = 30;
  const height = top.length * rowH + 10;
  const labelW = Math.min(150, Math.round(width * 0.34));
  const valueW = 62;
  const barMax = Math.max(40, width - labelW - valueW - 8);
  const max = Math.max(1, ...top.map((d) => Number(d.quantity) || 0));

  const rows = top.map((dish, index) => {
    const y = 10 + index * rowH;
    const quantity = Number(dish.quantity) || 0;
    const barW = Math.max(2, Math.round((quantity / max) * barMax));
    const label = dish.dishName || 'Dish';
    const short = label.length > 22 ? `${label.slice(0, 21)}…` : label;
    return `
      <text class="axis-text" x="0" y="${y + 15}" dominant-baseline="middle">${escapeHtml(short)}</text>
      <rect class="track" x="${labelW}" y="${y + 4}" width="${barMax}" height="14" rx="7"></rect>
      <rect class="bar" x="${labelW}" y="${y + 4}" width="${barW}" height="14" rx="7">
        <title>${escapeHtml(`${label}: ${pluralize(quantity, 'serving')} · ${formatCents(dish.revenueCents || 0)}`)}</title>
      </rect>
      <text class="axis-text" x="${labelW + barMax + 6}" y="${y + 15}" dominant-baseline="middle">${escapeHtml(String(quantity))}</text>`;
  }).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
     preserveAspectRatio="xMidYMid meet" role="img"
     aria-label="Top dishes by servings: ${escapeHtml(top.map((d) => `${d.dishName} ${d.quantity}`).join(', '))}">
    ${rows}
  </svg>`;
}

function mealPeriodChart(entries, width) {
  const lunch = entries.find((e) => e.mealPeriod === 'LUNCH') || { orderCount: 0, revenueCents: 0 };
  const dinner = entries.find((e) => e.mealPeriod === 'DINNER') || { orderCount: 0, revenueCents: 0 };
  const max = Math.max(1, Number(lunch.orderCount) || 0, Number(dinner.orderCount) || 0);
  const totalOrders = (Number(lunch.orderCount) || 0) + (Number(dinner.orderCount) || 0);
  const height = 132;
  const labelW = Math.min(96, Math.round(width * 0.22));
  const barMax = Math.max(40, width - labelW - 8);

  const row = (label, entry, y, cls) => {
    const count = Number(entry.orderCount) || 0;
    const barW = Math.max(2, Math.round((count / max) * barMax));
    const share = totalOrders ? Math.round((count / totalOrders) * 100) : 0;
    return `
      <text class="axis-text" x="0" y="${y + 14}" dominant-baseline="middle">${escapeHtml(label)}</text>
      <rect class="track" x="${labelW}" y="${y + 2}" width="${barMax}" height="24" rx="8"></rect>
      <rect class="${cls}" x="${labelW}" y="${y + 2}" width="${barW}" height="24" rx="8">
        <title>${escapeHtml(`${label}: ${pluralize(count, 'order')} · ${formatCents(entry.revenueCents || 0)}`)}</title>
      </rect>
      <text class="axis-text" x="${labelW + barMax}" y="${y + 46}" text-anchor="end">
        ${escapeHtml(`${count} orders · ${formatCents(entry.revenueCents || 0)}`)}
      </text>`;
  };

  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
     preserveAspectRatio="xMidYMid meet" role="img"
     aria-label="Lunch versus dinner orders">
    ${row('Lunch', lunch, 6, 'bar')}
    ${row('Dinner', dinner, 74, 'bar bar-alt')}
    <text class="axis-text" x="0" y="${height - 6}">
      ${escapeHtml(totalOrders ? `Lunch ${Math.round(((lunch.orderCount || 0) / totalOrders) * 100)}% · Dinner ${Math.round(((dinner.orderCount || 0) / totalOrders) * 100)}% of orders` : 'No orders yet')}
    </text>
  </svg>`;
}

/** Dual-series line chart: orders (left axis) + revenue (right axis). */
function trendChart(points, width) {
  if (!points.length) return emptyChart('No trend data for the last week.');
  const padLeft = 44;
  const padRight = 62;
  const padTop = 18;
  const padBottom = 34;
  const height = 260;
  const plotW = Math.max(60, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;
  const n = points.length;

  const orders = points.map((p) => Number(p.orderCount) || 0);
  const revenue = points.map((p) => Number(p.revenueCents) || 0);
  const maxOrders = Math.max(1, ...orders);
  const maxRevenue = Math.max(1, ...revenue);
  const niceMax = (value) => {
    const step = Math.pow(10, Math.floor(Math.log10(value)));
    const scaled = value / step;
    const rounded = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return rounded * step;
  };
  const ordersTop = niceMax(maxOrders);
  const revenueTop = niceMax(maxRevenue);

  const xAt = (i) => padLeft + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (value, top) => padTop + plotH - (value / top) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padTop + plotH - ratio * plotH;
    const orderLabel = Math.round(ordersTop * ratio);
    const revenueLabel = Math.round((revenueTop * ratio) / 100);
    return `
      <line class="grid-line" x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}"></line>
      <text class="axis-text" x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${orderLabel}</text>
      <text class="axis-text" x="${padLeft + plotW + 8}" y="${y + 4}">¥${revenueLabel}</text>`;
  }).join('');

  const ordersPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(orders[i], ordersTop).toFixed(1)}`).join(' ');
  const revenuePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(revenue[i], revenueTop).toFixed(1)}`).join(' ');
  const areaPath = `${ordersPath} L${xAt(n - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${xAt(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  const xLabels = points.map((p, i) => `<text class="axis-text" x="${xAt(i).toFixed(1)}" y="${height - 12}" text-anchor="middle">
      ${escapeHtml(formatWeekday(p.date))}
    </text>
    <text class="axis-text" x="${xAt(i).toFixed(1)}" y="${height - 1}" text-anchor="middle">${escapeHtml(formatDateShort(p.date))}</text>`).join('');

  const dots = points.map((p, i) => `
    <circle class="point point-orders" cx="${xAt(i).toFixed(1)}" cy="${yAt(orders[i], ordersTop).toFixed(1)}" r="4"></circle>
    <circle class="point point-revenue" cx="${xAt(i).toFixed(1)}" cy="${yAt(revenue[i], revenueTop).toFixed(1)}" r="4"></circle>`).join('');

  return `<svg class="chart-svg" data-role="trend-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
     preserveAspectRatio="xMidYMid meet" role="img"
     aria-label="Seven day trend of orders and revenue">
    ${gridLines}
    <path class="area-orders" d="${areaPath}"></path>
    <path class="line-orders" d="${ordersPath}"></path>
    <path class="line-revenue" d="${revenuePath}"></path>
    ${dots}
    ${xLabels}
    <line class="guide" data-role="guide" x1="0" y1="${padTop}" x2="0" y2="${padTop + plotH}" style="display:none"></line>
  </svg>
  <div class="chart-tooltip" data-role="tooltip" hidden></div>`;
}

function wireTrendTooltip(wrap, points) {
  const svg = wrap.querySelector('[data-role="trend-svg"]');
  const tooltip = wrap.querySelector('[data-role="tooltip"]');
  const guide = wrap.querySelector('[data-role="guide"]');
  if (!svg || !tooltip || !points.length) return;

  const viewW = Number(svg.viewBox.baseVal.width) || 600;
  const padLeft = 44;
  const padRight = 62;
  const plotW = Math.max(60, viewW - padLeft - padRight);
  const n = points.length;
  const xAt = (i) => padLeft + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  const hide = () => {
    tooltip.hidden = true;
    if (guide) guide.style.display = 'none';
  };

  svg.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const xInView = ((event.clientX - rect.left) / rect.width) * viewW;
    let index = 0;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      const distance = Math.abs(xAt(i) - xInView);
      if (distance < best) { best = distance; index = i; }
    }
    const point = points[index];
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${escapeHtml(dayLabel(point.date))}, ${escapeHtml(formatDateShort(point.date))}</strong>
      ${escapeHtml(pluralize(Number(point.orderCount) || 0, 'order'))}<br>
      ${escapeHtml(formatCents(point.revenueCents || 0))}`;
    tooltip.style.left = `${(xAt(index) / viewW) * 100}%`;
    tooltip.style.top = `${(18 / 260) * 100}%`;
    if (guide) {
      guide.setAttribute('x1', String(xAt(index)));
      guide.setAttribute('x2', String(xAt(index)));
      guide.style.display = '';
    }
  });

  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', hide, { passive: true });
}
