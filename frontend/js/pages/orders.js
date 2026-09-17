/* pages/orders.js — my orders list, order detail and cancellation. */

import { api, ApiError, normalizePage, isAbort } from '../api.js';
import {
  escapeHtml, formatCents, formatDate, formatDateTime, dayLabel, mealPeriodLabel, icon,
  statusBadge, skeletonLines, emptyStateHtml, errorStateHtml, toastSuccess, toastError,
  isRepeatClick, pagerHtml, wirePager, confirmDialog, imageUrlOr, truncate, pluralize,
} from '../utils.js';
import { navigate } from '../router.js';

const SIZE = 10;

/* -------------------------------------------------------------- list view */

export async function renderOrdersPage(root) {
  const list = { page: 0 };

  root.innerHTML = `<section class="page">
    <header class="page-head">
      <div>
        <h1>My orders</h1>
        <p class="page-sub">Every meal you have booked, newest first.</p>
      </div>
      <div class="page-head-actions">
        <a class="btn btn-outline" href="#/menu">${icon('menu')}<span>Order more</span></a>
      </div>
    </header>
    <div data-role="body">${skeletonLines(4)}</div>
    <nav class="pager" data-role="pager" aria-label="Order pages"></nav>
  </section>`;

  const body = root.querySelector('[data-role="body"]');
  const pager = root.querySelector('[data-role="pager"]');
  wirePager(pager, (page) => {
    list.page = page;
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  async function load() {
    body.innerHTML = skeletonLines(4);
    pager.innerHTML = '';
    try {
      const data = await api.get('/orders', { query: { page: list.page, size: SIZE } });
      const page = normalizePage(data);
      list.page = page.page;
      if (!page.items.length && page.totalElements === 0) {
        body.innerHTML = emptyStateHtml({
          title: 'No orders yet',
          message: 'Your first order will show up here as soon as you place it.',
          actionLabel: 'Browse today’s menu',
          actionAttrs: 'data-go-menu',
          iconName: 'receipt',
        });
        body.querySelector('[data-go-menu]')?.addEventListener('click', () => navigate('/menu'));
        return;
      }
      body.innerHTML = `<div class="stack">${page.items.map(orderCard).join('')}</div>`;
      const from = page.page * page.size + 1;
      const to = Math.min(page.totalElements, (page.page + 1) * page.size);
      pager.innerHTML = pagerHtml({
        page: page.page,
        totalPages: page.totalPages,
        info: `Showing ${from}–${to} of ${page.totalElements} orders`,
      });
    } catch (err) {
      if (isAbort(err)) return;
      body.innerHTML = errorStateHtml({
        title: 'Orders unavailable',
        message: err?.message || 'Could not load your orders.',
        retryAttrs: 'data-retry-orders',
      });
      body.querySelector('[data-retry-orders]')?.addEventListener('click', () => load());
    }
  }

  load();
  return () => {};
}

function orderCard(order) {
  const quantity = Number(order.totalQuantity) || 0;
  return `<article class="card order-card">
    <div class="order-card-head">
      <div>
        <div class="row">
          <span class="strong">${escapeHtml(dayLabel(order.deliveryDate))} · ${escapeHtml(mealPeriodLabel(order.mealPeriod))}</span>
          ${statusBadge(order.status)}
        </div>
        <div class="order-no">${escapeHtml(order.orderNo || `#${order.id}`)}</div>
      </div>
      <div class="right">
        <div class="price">${escapeHtml(formatCents(order.totalCents))}</div>
        <div class="tiny muted">${escapeHtml(pluralize(quantity, 'serving'))}</div>
      </div>
    </div>
    <p class="mb-0">${escapeHtml(truncate(order.itemSummary || 'No items', 160))}</p>
    <div class="row small muted">
      <span>${escapeHtml(formatDate(order.deliveryDate))}</span>
      <span aria-hidden="true">·</span>
      <span>Ordered ${escapeHtml(formatDateTime(order.createdAt))}</span>
    </div>
    <div class="row">
      <a class="btn btn-outline btn-sm" href="#/orders/${encodeURIComponent(order.id)}">View details</a>
      ${order.status === 'Pending' ? `<span class="tag tag-muted">Can still be cancelled</span>` : ''}
    </div>
  </article>`;
}

/* ------------------------------------------------------------ detail view */

export async function renderOrderDetailPage(root, params) {
  const orderId = params?.id;
  root.innerHTML = `<section class="page">
    <nav class="breadcrumb"><a href="#/orders">← All orders</a></nav>
    ${skeletonLines(6)}
  </section>`;

  let cancelled = false;

  async function load() {
    try {
      const order = await api.get(`/orders/${encodeURIComponent(orderId)}`);
      if (cancelled) return;
      render(order);
    } catch (err) {
      if (isAbort(err) || cancelled) return;
      const message = err instanceof ApiError && err.code === 'ORDER_NOT_FOUND'
        ? 'That order does not exist.'
        : (err?.message || 'Could not load this order.');
      root.innerHTML = `<section class="page">
        <nav class="breadcrumb"><a href="#/orders">← All orders</a></nav>
        ${errorStateHtml({ title: 'Order unavailable', message, retryLabel: 'Retry', retryAttrs: 'data-retry' })}
      </section>`;
      root.querySelector('[data-retry]')?.addEventListener('click', () => {
        root.innerHTML = `<section class="page"><nav class="breadcrumb"><a href="#/orders">← All orders</a></nav>${skeletonLines(6)}</section>`;
        load();
      });
    }
  }

  function render(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const cancellable = order.status === 'Pending';
    const totalCents = Number(order.totalCents) || items.reduce((acc, it) => acc + (Number(it.subtotalCents) || 0), 0);

    root.innerHTML = `<section class="page">
      <nav class="breadcrumb"><a href="#/orders">← All orders</a></nav>
      <header class="page-head">
        <div>
          <div class="row">
            <h1 class="mb-0">Order ${escapeHtml(order.orderNo || `#${order.id}`)}</h1>
            ${statusBadge(order.status)}
          </div>
          <p class="page-sub">Placed ${escapeHtml(formatDateTime(order.createdAt))}</p>
        </div>
        <div class="page-head-actions">
          ${cancellable ? '<button type="button" class="btn btn-danger-ghost" data-cancel>Cancel order</button>' : ''}
          <a class="btn btn-outline" href="#/menu">Order again</a>
        </div>
      </header>

      <div class="checkout-layout">
        <div class="card">
          <div class="card-head"><h2>Items</h2><span class="badge badge-neutral">${escapeHtml(pluralize(Number(order.totalQuantity) || items.length, 'serving'))}</span></div>
          <div class="card-body">
            ${items.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Dish</th><th>Options</th><th>Qty</th><th>Unit</th><th>Subtotal</th></tr></thead>
              <tbody>${items.map(itemRow).join('')}</tbody>
            </table></div>` : '<p class="muted mb-0">No item detail was returned for this order.</p>'}
          </div>
          <div class="card-foot">
            <div class="kv"><dt>Items</dt><dd>${escapeHtml(formatCents(items.reduce((a, it) => a + (Number(it.subtotalCents) || 0), 0)))}</dd></div>
            <div class="kv"><dt>Delivery</dt><dd>Free</dd></div>
            <div class="kv kv-total"><dt>Total</dt><dd>${escapeHtml(formatCents(totalCents))}</dd></div>
          </div>
        </div>

        <aside class="checkout-aside stack">
          <div class="card card-pad">
            <h2>Delivery</h2>
            <dl>
              <div class="kv"><dt>Date</dt><dd>${escapeHtml(dayLabel(order.deliveryDate))} · ${escapeHtml(formatDate(order.deliveryDate))}</dd></div>
              <div class="kv"><dt>Meal period</dt><dd>${escapeHtml(mealPeriodLabel(order.mealPeriod))}</dd></div>
              <div class="kv"><dt>Status</dt><dd>${escapeHtml(order.status || '—')}</dd></div>
              <div class="kv"><dt>Address</dt><dd>${escapeHtml(order.address || '—')}</dd></div>
            </dl>
            <p class="help mb-0">${cancellable
              ? 'You can cancel this order while it is still pending. Stock is returned immediately.'
              : 'Only pending orders can be cancelled.'}</p>
          </div>
        </aside>
      </div>
    </section>`;

    const cancelBtn = root.querySelector('[data-cancel]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (isRepeatClick(cancelBtn, 400)) return;
        const ok = await confirmDialog({
          title: 'Cancel this order?',
          message: `Order ${order.orderNo || `#${order.id}`} (${dayLabel(order.deliveryDate)} ${mealPeriodLabel(order.mealPeriod)}) will be cancelled and the stock released.`,
          confirmLabel: 'Cancel order',
          cancelLabel: 'Keep order',
          tone: 'danger',
        });
        if (!ok) return;
        cancelBtn.disabled = true;
        cancelBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Cancelling…</span>';
        try {
          await api.post(`/orders/${encodeURIComponent(order.id)}/cancel`);
          toastSuccess('Order cancelled.');
          await load();
        } catch (err) {
          cancelBtn.disabled = false;
          cancelBtn.textContent = 'Cancel order';
          const message = err instanceof ApiError
            ? (err.code === 'ORDER_NOT_CANCELLABLE'
              ? 'This order can no longer be cancelled because it is no longer pending.'
              : err.message)
            : 'Could not cancel the order.';
          toastError(message);
        }
      });
    }
  }

  load();
  return () => { cancelled = true; };
}

function itemRow(item) {
  const options = Array.isArray(item.options) && item.options.length
    ? escapeHtml(item.options.map((o) => `${o.groupName ? `${o.groupName}: ` : ''}${o.optionName}${Number(o.extraPriceCents) > 0 ? ` +${formatCents(o.extraPriceCents)}` : ''}`).join(', '))
    : '<span class="muted">—</span>';
  return `<tr>
    <td class="cell-main" data-label="Dish">
      <span class="cell-name">
        <img class="thumb" src="${escapeHtml(imageUrlOr(item.imageUrl))}" alt="" loading="lazy" width="46" height="46">
        <span>
          <span class="name">${escapeHtml(item.dishName || 'Dish')}</span>
          <span class="cell-sub">${escapeHtml(formatCents(item.basePriceCents))} base</span>
        </span>
      </span>
    </td>
    <td data-label="Options">${options}</td>
    <td data-label="Qty">${escapeHtml(String(item.quantity ?? 1))}</td>
    <td data-label="Unit">${escapeHtml(formatCents(item.unitPriceCents))}</td>
    <td data-label="Subtotal">${escapeHtml(formatCents(item.subtotalCents))}</td>
  </tr>`;
}
