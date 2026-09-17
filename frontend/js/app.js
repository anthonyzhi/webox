/* app.js — application shell: header/nav, cart drawer, AI panel, global error surface. */

import {
  hydrateFromStorage, getState, getToken, getUser, isAdmin, subscribe, setUser,
  setPreferences, clearAuth, cartServings, cartTotalCents, getCart, maxQuantityPerOrder,
  lineLimitReason, increaseLine, decreaseLine, removeLine, openCart, closeCart, openAiPanel,
  closeAiPanel,
} from './store.js';
import { loadSession, logout, ApiError } from './api.js';
import {
  ICONS, icon, escapeHtml, formatCents, toast, toastError, closeTopDialog,
  imageUrlOr, isRepeatClick,
} from './utils.js';
import { startRouter, navigate } from './router.js';
import { initAiPanel, closeAiStream } from './ai.js';

let lastShellSignature = '';
let lastCartServings = 0;

/* ------------------------------------------------------------------ shell */

function shellSignature() {
  const user = getUser();
  return `${user ? `${user.id}:${user.role}` : 'anon'}`;
}

function renderShell() {
  const user = getUser();
  const authed = Boolean(getToken() && user);
  const admin = isAdmin();
  const header = document.getElementById('app-header');
  const sidebar = document.getElementById('sidebar');
  const bottomNav = document.getElementById('bottom-nav');
  const shell = document.getElementById('shell');
  if (!header) return;

  document.body.classList.toggle('is-console', authed && admin);
  shell.classList.toggle('console-layout', authed && admin);
  sidebar.hidden = !(authed && admin);

  const displayName = user?.displayName || user?.email || 'User';
  const initial = String(displayName).trim().charAt(0) || 'U';
  const roleLabel = admin ? 'Administrator' : 'Employee';

  const userChip = authed ? `<span class="user-chip">
      <span class="avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <span class="user-meta">
        <span>${escapeHtml(displayName)}</span>
        <span class="tiny">${escapeHtml(roleLabel)}</span>
      </span>
    </span>` : '';

  const logoutButton = authed
    ? `<button type="button" class="btn-icon" data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button>`
    : '';

  if (!authed) {
    header.innerHTML = `<div class="app-header-inner">
      <a class="brand" href="#/login"><span class="brand-mark" aria-hidden="true">${ICONS.dish}</span><span>WeBox</span></a>
      <div class="header-actions">
        <a class="btn btn-outline btn-sm" href="#/login">Sign in</a>
        <a class="btn btn-primary btn-sm" href="#/register">Create account</a>
      </div>
    </div>`;
  } else if (admin) {
    header.innerHTML = `<div class="app-header-inner">
      <a class="brand" href="#/console/dashboard">
        <span class="brand-mark" aria-hidden="true">${ICONS.dish}</span>
        <span>WeBox <span class="brand-sub">Console</span></span>
      </a>
      <div class="header-actions">${userChip}${logoutButton}</div>
    </div>`;
  } else {
    header.innerHTML = `<div class="app-header-inner">
      <a class="brand" href="#/menu"><span class="brand-mark" aria-hidden="true">${ICONS.dish}</span><span>WeBox</span></a>
      <nav class="nav-primary" aria-label="Main">
        <a class="nav-link" href="#/menu" data-nav-link="/menu">${icon('menu')}<span>Menu</span></a>
        <a class="nav-link" href="#/orders" data-nav-link="/orders">${icon('receipt')}<span>My orders</span></a>
        <a class="nav-link" href="#/preferences" data-nav-link="/preferences">${icon('sliders')}<span>Preferences</span></a>
      </nav>
      <div class="header-actions">
        <button type="button" class="btn-icon" data-ai-toggle aria-label="Open AI meal assistant" title="AI assistant">${icon('sparkles')}</button>
        <button type="button" class="btn-icon cart-button" data-cart-toggle aria-label="Open cart" title="Your cart">
          ${icon('cart')}<span class="cart-count" data-cart-count hidden>0</span>
        </button>
        ${userChip}${logoutButton}
      </div>
    </div>`;
  }

  if (authed && admin) {
    sidebar.innerHTML = `
      <p class="sidebar-title">Console</p>
      <a class="sidebar-link" href="#/console/dashboard" data-nav-link="/console/dashboard">${icon('chart')}<span>Dashboard</span></a>
      <a class="sidebar-link" href="#/console/dishes" data-nav-link="/console/dishes">${icon('dish')}<span>Dishes</span></a>
      <a class="sidebar-link" href="#/console/menu" data-nav-link="/console/menu">${icon('calendarMenu')}<span>Daily menu</span></a>`;
  } else {
    sidebar.innerHTML = '';
  }

  bottomNav.hidden = !(authed && !admin);
  if (authed && !admin) {
    bottomNav.innerHTML = `
      <a class="bottom-nav-item" href="#/menu" data-nav-link="/menu">${icon('menu')}<span>Menu</span></a>
      <a class="bottom-nav-item" href="#/orders" data-nav-link="/orders">${icon('receipt')}<span>Orders</span></a>
      <a class="bottom-nav-item" href="#/preferences" data-nav-link="/preferences">${icon('sliders')}<span>Prefs</span></a>
      <button type="button" class="bottom-nav-item" data-ai-toggle>${icon('sparkles')}<span>Assistant</span></button>`;
  } else {
    bottomNav.innerHTML = '';
  }

  updateCartBadge();
  markActiveNav(getState().route || {});
  lastShellSignature = shellSignature();
}

function markActiveNav(route) {
  const path = route?.path || '';
  document.querySelectorAll('[data-nav-link]').forEach((link) => {
    const target = link.dataset.navLink;
    let active = path === target || path.startsWith(`${target}/`);
    if (target === '/menu' && path.startsWith('/dish')) active = true;
    if (target === '/orders' && path.startsWith('/orders/')) active = true;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateCartBadge() {
  const count = cartServings();
  document.querySelectorAll('[data-cart-count]').forEach((badge) => {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
}

function bumpCartButton() {
  const btn = document.querySelector('.cart-button');
  if (!btn) return;
  btn.classList.remove('is-bumped');
  void btn.offsetWidth;
  btn.classList.add('is-bumped');
  window.setTimeout(() => btn.classList.remove('is-bumped'), 500);
}

/* ------------------------------------------------------------ cart drawer */

function renderCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  if (!drawer) return;
  const cart = getCart();
  const max = maxQuantityPerOrder();
  const servings = cartServings();
  const total = cartTotalCents();

  const lines = cart.map((line) => {
    const limit = lineLimitReason(line);
    const atMax = Number.isFinite(line.remaining) && line.quantity >= line.remaining;
    const canIncrease = !limit && !atMax;
    return `<div class="cart-line" data-line="${escapeHtml(line.key)}">
      <img class="cart-line-media" src="${escapeHtml(imageUrlOr(line.imageUrl))}" alt="" loading="lazy" width="62" height="62">
      <div class="cart-line-body">
        <span class="cart-line-name">${escapeHtml(line.name)}</span>
        ${line.optionText ? `<span class="cart-line-opts">${escapeHtml(line.optionText)}</span>` : ''}
        ${line.soldOut ? '<span class="badge badge-stock is-out">Sold out</span>' : ''}
        <span class="cart-line-actions">
          <span class="qty">
            <button type="button" class="qty-btn" data-dec aria-label="One fewer ${escapeHtml(line.name)}"
              title="${line.quantity <= 1 ? 'Remove this line' : 'One fewer serving'}">−</button>
            <span class="qty-value" aria-label="Quantity">${line.quantity}</span>
            <button type="button" class="qty-btn" data-inc aria-label="One more ${escapeHtml(line.name)}"
              ${canIncrease ? '' : 'disabled'}
              title="${escapeHtml(canIncrease ? 'One more serving' : (limit || 'Maximum reached'))}">+</button>
          </span>
          <span class="right">
            <span class="line-total">${escapeHtml(formatCents(line.unitPriceCents * line.quantity))}</span>
            <button type="button" class="btn-icon" data-remove aria-label="Remove ${escapeHtml(line.name)} from cart" title="Remove">${icon('trash')}</button>
          </span>
        </span>
      </div>
    </div>`;
  }).join('');

  drawer.innerHTML = `
    <div class="drawer-head">
      <h2>Your cart</h2>
      <button type="button" class="btn-icon" data-close aria-label="Close cart">${icon('close')}</button>
    </div>
    <div class="drawer-body">
      ${cart.length ? lines : `<div class="cart-empty">
        ${icon('cart')}
        <h3>Your cart is empty</h3>
        <p class="muted">Add a dish from today’s menu to get started.</p>
        <button type="button" class="btn btn-outline" data-browse-menu>Browse the menu</button>
      </div>`}
    </div>
    <div class="drawer-foot">
      <div class="cart-summary">
        <span>${servings} of ${max} servings</span>
        <span>${cart.length ? `Max ${max} per order` : 'Nothing added yet'}</span>
      </div>
      <div class="cart-total">
        <span class="muted strong">Total</span>
        <span class="price">${escapeHtml(formatCents(total))}</span>
      </div>
      <button type="button" class="btn btn-primary btn-lg btn-block" data-checkout
        ${cart.length ? '' : 'disabled'}
        title="${escapeHtml(cart.length ? 'Continue to checkout' : 'Add at least one dish to check out')}">Checkout</button>
    </div>`;
}

function onCartDrawerClick(event) {
  const drawer = document.getElementById('cart-drawer');
  const closeBtn = event.target.closest('[data-close]');
  if (closeBtn) { closeCart(); return; }

  const browse = event.target.closest('[data-browse-menu]');
  if (browse) { closeCart(); navigate('/menu'); return; }

  const checkout = event.target.closest('[data-checkout]');
  if (checkout) {
    if (checkout.disabled || isRepeatClick(checkout, 400)) return;
    closeCart();
    navigate('/checkout');
    return;
  }

  const lineEl = event.target.closest('[data-line]');
  if (!lineEl) return;
  const key = lineEl.dataset.line;

  const inc = event.target.closest('[data-inc]');
  if (inc) {
    if (inc.disabled || isRepeatClick(inc, 250)) return;
    const result = increaseLine(key);
    if (!result.ok) toast(result.reason, { type: 'warn' });
    return;
  }

  const dec = event.target.closest('[data-dec]');
  if (dec) {
    if (isRepeatClick(dec, 250)) return;
    const line = getCart().find((l) => l.key === key);
    if (!line) return;
    if (line.quantity <= 1) removeLine(key);
    else {
      const result = decreaseLine(key);
      if (!result.ok) toast(result.reason, { type: 'warn' });
    }
    return;
  }

  const remove = event.target.closest('[data-remove]');
  if (remove) {
    if (isRepeatClick(remove, 250)) return;
    removeLine(key);
    return;
  }
  void drawer;
}

/* ------------------------------------------------------- overlay / drawers */

function syncOverlays(state) {
  const cartOpen = Boolean(state.cartOpen);
  const aiOpen = Boolean(state.aiOpen);
  const cartDrawer = document.getElementById('cart-drawer');
  const cartOverlay = document.getElementById('cart-overlay');
  const aiPanel = document.getElementById('ai-panel');
  const aiOverlay = document.getElementById('ai-overlay');

  if (cartOpen) renderCartDrawer();
  cartDrawer.hidden = !cartOpen;
  cartOverlay.hidden = !cartOpen;
  aiPanel.hidden = !aiOpen;
  aiOverlay.hidden = !aiOpen;
  document.body.classList.toggle('is-locked', cartOpen || aiOpen);
  if (aiOpen) {
    const prompt = aiPanel.querySelector('#ai-prompt');
    if (prompt) window.setTimeout(() => prompt.focus(), 60);
  } else {
    closeAiStream();
  }
}

/* ---------------------------------------------------------------- events */

function onDocumentClick(event) {
  const aiToggle = event.target.closest('[data-ai-toggle]');
  if (aiToggle) {
    if (getState().aiOpen) closeAiPanel(); else openAiPanel();
    return;
  }
  const cartToggle = event.target.closest('[data-cart-toggle]');
  if (cartToggle) {
    if (getState().cartOpen) closeCart(); else openCart();
    return;
  }
  const logoutBtn = event.target.closest('[data-logout]');
  if (logoutBtn) {
    if (isRepeatClick(logoutBtn, 600)) return;
    signOut(logoutBtn);
    return;
  }
  const overlay = event.target.closest('.overlay');
  if (overlay) {
    const which = overlay.dataset.close;
    if (which === 'cart') closeCart();
    if (which === 'ai') closeAiPanel();
  }
}

function onKeydown(event) {
  if (event.key !== 'Escape') return;
  const dialogHost = document.getElementById('dialog-host');
  if (dialogHost && !dialogHost.hidden) {
    closeTopDialog();
    return;
  }
  const state = getState();
  if (state.aiOpen) { closeAiPanel(); return; }
  if (state.cartOpen) closeCart();
}

async function signOut(button) {
  if (button) button.disabled = true;
  await logout();
  clearAuth();
  closeCart();
  closeAiPanel();
  toast('You have been signed out.', { type: 'success' });
  navigate('/login', { replace: true });
}

function onUnhandledRejection(event) {
  const reason = event.reason;
  if (reason?.name === 'AbortError') return;
  if (reason instanceof ApiError) {
    if (reason.status === 401) return; // already handled by the api wrapper
    toastError(reason.message, { title: 'Request failed' });
    return;
  }
  console.error('[app] unhandled error', reason);
  toastError('Something unexpected happened. Please try again.');
}

/* -------------------------------------------------------------- bootstrap */

function onStateChange(state, patch) {
  if (patch && ('cartOpen' in patch || 'aiOpen' in patch)) syncOverlays(state);
  if (patch && 'cart' in patch) {
    updateCartBadge();
    const servings = cartServings();
    if (servings > lastCartServings) bumpCartButton();
    lastCartServings = servings;
    if (state.cartOpen) renderCartDrawer();
  }
  if (patch && ('user' in patch || 'token' in patch)) {
    if (shellSignature() !== lastShellSignature) renderShell();
  }
  if (patch && 'route' in patch) markActiveNav(state.route || {});
}

async function bootstrap() {
  hydrateFromStorage();
  renderShell();

  const cartDrawer = document.getElementById('cart-drawer');
  if (cartDrawer) {
    cartDrawer.addEventListener('click', onCartDrawerClick);
    renderCartDrawer();
  }
  const aiPanel = document.getElementById('ai-panel');
  if (aiPanel) initAiPanel(aiPanel);

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  subscribe(onStateChange);
  syncOverlays(getState());

  if (getToken()) {
    try {
      const me = await loadSession();
      if (me?.user) setUser(me.user);
      if (me?.preferences) setPreferences(me.preferences);
    } catch (err) {
      // 401 is handled by the api wrapper (clears the session and redirects).
    }
  }

  renderShell();
  lastCartServings = cartServings();

  startRouter({
    view: document.getElementById('view'),
    onNavigate: (route) => {
      markActiveNav(route);
      closeCart();
      closeAiPanel();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
