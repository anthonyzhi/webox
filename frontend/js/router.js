/* router.js — hash router with role guards.
 * Pages export `render(root, params)` and may return a cleanup function.
 */

import { isAuthenticated, isAdmin, getUser, clearAuth, setState, roleHome } from './store.js';
import { toast, emptyStateHtml, escapeHtml } from './utils.js';

import { renderLogin, renderRegister } from './pages/auth.js';
import { renderMenuPage } from './pages/menu.js';
import { renderDishPage } from './pages/dish.js';
import { renderCheckoutPage } from './pages/checkout.js';
import { renderOrdersPage, renderOrderDetailPage } from './pages/orders.js';
import { renderPreferencesPage } from './pages/preferences.js';
import { renderConsoleDishes } from './pages/console-dishes.js';
import { renderConsoleMenu } from './pages/console-menu.js';
import { renderConsoleDashboard } from './pages/console-dashboard.js';

export const ROUTES = [
  { path: '/login', title: 'Sign in', access: 'public', render: renderLogin },
  { path: '/register', title: 'Create account', access: 'public', render: renderRegister },

  { path: '/menu', title: 'Menu', access: 'employee', render: renderMenuPage },
  { path: '/dish/:menuId', title: 'Dish', access: 'employee', render: renderDishPage },
  { path: '/checkout', title: 'Checkout', access: 'employee', render: renderCheckoutPage },
  { path: '/orders', title: 'My orders', access: 'employee', render: renderOrdersPage },
  { path: '/orders/:id', title: 'Order detail', access: 'employee', render: renderOrderDetailPage },
  { path: '/preferences', title: 'Preferences', access: 'employee', render: renderPreferencesPage },

  { path: '/console/dishes', title: 'Dishes · Console', access: 'admin', render: renderConsoleDishes },
  { path: '/console/menu', title: 'Daily menu · Console', access: 'admin', render: renderConsoleMenu },
  { path: '/console/dashboard', title: 'Dashboard · Console', access: 'admin', render: renderConsoleDashboard },
];

let container = null;
let onNavigate = null;
let cleanup = () => {};
let current = { path: '/menu', params: {}, query: {} };
let renderToken = 0;

/* ------------------------------------------------------------- matching */

function matchRoute(path) {
  const segments = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const routeSegments = route.path.split('/').filter(Boolean);
    if (routeSegments.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      const rs = routeSegments[i];
      if (rs.startsWith(':')) params[rs.slice(1)] = decodeURIComponent(segments[i]);
      else if (rs !== segments[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart && pathPart.startsWith('/') ? pathPart : (pathPart ? `/${pathPart}` : '/');
  const query = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => { query[key] = value; });
  }
  return { path: path.replace(/\/+$/, '') || '/', query };
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === target) {
    render();
    return;
  }
  if (replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    render();
  } else {
    window.location.hash = target;
  }
}

export function currentRoute() { return current; }

/* ----------------------------------------------------------- guard logic */

function accessDeniedHtml(message) {
  return `<section class="page">
    <div class="card empty-state error-state">
      <h3>403 · Access denied</h3>
      <p class="muted">${escapeHtml(message)}</p>
      <a class="btn btn-primary" href="${roleHome()}">Go to my home</a>
    </div>
  </section>`;
}

function resolveGuard(matched) {
  const { route } = matched;
  const authed = isAuthenticated();
  const user = getUser();
  const role = user?.role;

  if (route.access === 'public') {
    if (authed && (role === 'ADMIN' || role === 'EMPLOYEE')) {
      return { redirect: roleHome(role) };
    }
    if (authed && role !== 'EMPLOYEE' && role !== 'ADMIN') {
      // Unknown role: never let an unknown principal roam the app.
      clearAuth();
      return { redirect: '#/login' };
    }
    return { ok: true };
  }

  if (!authed) {
    const next = encodeURIComponent(`#${current.path}`);
    return { redirect: `#/login?next=${next}` };
  }

  if (role !== 'EMPLOYEE' && role !== 'ADMIN') {
    clearAuth();
    toast('Your account role is not recognised. Please sign in again.', { type: 'warn' });
    return { redirect: '#/login' };
  }

  if (route.access === 'admin' && !isAdmin()) {
    return { ok: true, denied: accessDeniedHtml('The Console is available to administrators only. Your account has employee access.') };
  }

  if (route.access === 'employee' && isAdmin()) {
    return { redirect: '/console/dashboard', notice: 'The Console is your home — employee ordering screens are hidden for admin accounts.' };
  }

  return { ok: true };
}

/* --------------------------------------------------------------- render */

export async function render() {
  if (!container) return;
  const { path, query } = parseHash();
  current = { path, query, params: {} };

  // Default landing per role.
  if (path === '/' || path === '/home' || path === '/index.html') {
    navigate(roleHome(), { replace: true });
    return;
  }

  const matched = matchRoute(path);
  const token = ++renderToken;

  if (!matched) {
    teardown();
    document.title = 'Not found · WeBox';
    container.innerHTML = `<section class="page">${emptyStateHtml({
      title: 'Page not found',
      message: `No screen matches “${path}”. Use the navigation to keep browsing.`,
      actionLabel: 'Back to menu',
      actionAttrs: `data-nav="${roleHome()}"`,
      iconName: 'alert',
    })}</section>`;
    wireCommonNav();
    notify({ ...current, notFound: true });
    return;
  }

  const guard = resolveGuard(matched);
  if (guard.redirect) {
    if (guard.notice) toast(guard.notice, { type: 'info' });
    navigate(guard.redirect, { replace: true });
    return;
  }

  teardown();
  current = { path, query, params: matched.params, route: matched.route };
  setState({ route: current });
  document.title = `${matched.route.title} · WeBox`;
  container.setAttribute('aria-busy', 'false');
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (guard.denied) {
    container.innerHTML = guard.denied;
    notify(current);
    return;
  }

  container.innerHTML = '';
  try {
    const result = await matched.route.render(container, { ...matched.params, query });
    if (token !== renderToken) {
      // A newer navigation already happened — discard this page's cleanup.
      if (typeof result === 'function') result();
      return;
    }
    cleanup = typeof result === 'function' ? result : () => {};
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('[router] page render failed', err);
    container.innerHTML = `<section class="page"><div class="card empty-state error-state">
      <h3>This page failed to load</h3>
      <p class="muted">${escapeHtml(err?.message || 'Unexpected error.')}</p>
      <button class="btn btn-outline" data-nav="${roleHome()}">Go to my home</button>
    </div></section>`;
    wireCommonNav();
  }

  notify(current);
}

function teardown() {
  try { cleanup(); } catch (err) { console.error('[router] cleanup failed', err); }
  cleanup = () => {};
  setState({ cartOpen: false, aiOpen: false });
}

function wireCommonNav() {
  container.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(btn.dataset.nav);
    });
  });
}

function notify(route) {
  if (typeof onNavigate === 'function') onNavigate(route);
}

export function startRouter({ view, onNavigate: handler }) {
  container = view;
  onNavigate = handler;
  window.addEventListener('hashchange', render);
  render();
}

export { wireCommonNav };
