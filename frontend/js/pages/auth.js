/* pages/auth.js — sign in + create account. */

import { api, ApiError, loadSession } from '../api.js';
import { setAuth, setPreferences, setUser, roleHome, getToken } from '../store.js';
import {
  LIMITS, ICONS, escapeHtml, toast, setBusy, clearFieldErrors, applyFieldErrors, setFieldError,
  validateEmail, validatePassword, validateDisplayName,
} from '../utils.js';
import { navigate } from '../router.js';

function brandMark() {
  return `<span class="brand-mark" aria-hidden="true">${ICONS.dish}</span>`;
}

function safeNext(query) {
  const raw = query?.next ? String(query.next) : '';
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (err) { decoded = raw; }
  if (decoded.startsWith('#/') && !decoded.startsWith('#/login')) return decoded;
  return '';
}

async function finishAuth(response, next) {
  setAuth({ token: response.token, user: response.user, expiresAt: response.expiresAt });
  try {
    const me = await loadSession();
    if (me?.user) setUser(me.user);
    if (me?.preferences) setPreferences(me.preferences);
  } catch (err) {
    /* preferences are a nicety; the session is already usable */
  }
  const target = next || roleHome(response.user?.role);
  toast(`Signed in as ${response.user?.displayName || response.user?.email || 'user'}.`, { type: 'success' });
  navigate(target);
}

/** Wire blur-time live validation for the simple text inputs. */
function liveValidate(form, name, validator) {
  const input = form.querySelector(`[name="${name}"]`);
  if (!input) return;
  input.addEventListener('blur', () => {
    if (!input.value) { setFieldError(form, name, ''); return; }
    setFieldError(form, name, validator(input.value) || '');
  });
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') setFieldError(form, name, '');
  });
}

function authHeader({ title, subtitle }) {
  return `<div class="auth-brand">
    ${brandMark()}
    <h1>${escapeHtml(title)}</h1>
    <p class="muted mb-0">${escapeHtml(subtitle)}</p>
  </div>`;
}

/* ---------------------------------------------------------------- login */

export function renderLogin(root, params = {}) {
  const next = safeNext(params.query);
  if (getToken()) {
    navigate(roleHome());
    return () => {};
  }

  root.innerHTML = `<section class="auth-shell">
    <div class="auth-card">
      ${authHeader({ title: 'Welcome back', subtitle: 'Sign in to order today’s lunch or dinner.' })}
      <form class="card card-pad" data-form novalidate>
        <div class="field">
          <label class="label" for="login-email">Work email</label>
          <input class="input" id="login-email" name="email" type="email" maxlength="${LIMITS.email}"
                 autocomplete="username" inputmode="email" placeholder="name@company.com" required>
          <p class="field-error" data-error-for="email" role="alert"></p>
        </div>
        <div class="field">
          <label class="label" for="login-password">Password</label>
          <input class="input" id="login-password" name="password" type="password" maxlength="${LIMITS.passwordMax}"
                 autocomplete="current-password" required>
          <p class="field-error" data-error-for="password" role="alert"></p>
        </div>
        <p class="field-error" data-error-for="form" role="alert"></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-submit>Sign in</button>
      </form>
      <p class="auth-hint">New to WeBox? <a href="#/register">Create an account</a></p>
    </div>
  </section>`;

  const form = root.querySelector('[data-form]');
  const submit = root.querySelector('[data-submit]');
  liveValidate(form, 'email', validateEmail);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const email = form.email.value.trim();
    const password = form.password.value;
    const emailError = validateEmail(email);
    const passwordError = password ? '' : 'Password is required.';

    if (emailError) setFieldError(form, 'email', emailError);
    if (passwordError) setFieldError(form, 'password', passwordError);
    if (emailError || passwordError) return;

    setBusy(submit, true, 'Signing in…');
    try {
      const response = await api.post('/auth/login', { email, password }, { allow401: true });
      await finishAuth(response, next);
    } catch (err) {
      handleAuthError(err, form, submit, 'Sign in');
    }
  });

  return () => {};
}

/* -------------------------------------------------------------- register */

export function renderRegister(root, params = {}) {
  const next = safeNext(params.query);
  if (getToken()) {
    navigate(roleHome());
    return () => {};
  }

  root.innerHTML = `<section class="auth-shell">
    <div class="auth-card">
      ${authHeader({ title: 'Create your account', subtitle: 'Set up WeBox in a few seconds and order your first meal.' })}
      <form class="card card-pad" data-form novalidate>
        <div class="field">
          <label class="label" for="reg-name">Display name</label>
          <input class="input" id="reg-name" name="displayName" type="text" maxlength="${LIMITS.displayName}"
                 autocomplete="name" placeholder="Alex Chen" required>
          <p class="help">Shown on your orders and receipts.</p>
          <p class="field-error" data-error-for="displayName" role="alert"></p>
        </div>
        <div class="field">
          <label class="label" for="reg-email">Work email</label>
          <input class="input" id="reg-email" name="email" type="email" maxlength="${LIMITS.email}"
                 autocomplete="username" inputmode="email" placeholder="name@company.com" required>
          <p class="field-error" data-error-for="email" role="alert"></p>
        </div>
        <div class="field">
          <label class="label" for="reg-password">Password</label>
          <input class="input" id="reg-password" name="password" type="password" maxlength="${LIMITS.passwordMax}"
                 autocomplete="new-password" required>
          <p class="help">At least ${LIMITS.passwordMin} characters with one letter and one digit.</p>
          <p class="field-error" data-error-for="password" role="alert"></p>
        </div>
        <div class="field">
          <label class="label" for="reg-confirm">Confirm password</label>
          <input class="input" id="reg-confirm" name="confirmPassword" type="password" maxlength="${LIMITS.passwordMax}"
                 autocomplete="new-password" required>
          <p class="field-error" data-error-for="confirmPassword" role="alert"></p>
        </div>
        <p class="field-error" data-error-for="form" role="alert"></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-submit>Create account</button>
      </form>
      <p class="auth-hint">Already have an account? <a href="#/login">Sign in</a></p>
    </div>
  </section>`;

  const form = root.querySelector('[data-form]');
  const submit = root.querySelector('[data-submit]');
  liveValidate(form, 'email', validateEmail);
  liveValidate(form, 'displayName', validateDisplayName);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const displayName = form.displayName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirm = form.confirmPassword.value;

    const errors = {
      displayName: validateDisplayName(displayName),
      email: validateEmail(email),
      password: validatePassword(password),
      confirmPassword: confirm === password ? '' : 'Passwords do not match.',
    };
    const hasError = Object.entries(errors).some(([name, message]) => {
      if (message) setFieldError(form, name, message);
      return Boolean(message);
    });
    if (hasError) return;

    setBusy(submit, true, 'Creating account…');
    try {
      const response = await api.post('/auth/register', { email, password, displayName });
      await finishAuth(response, next);
    } catch (err) {
      handleAuthError(err, form, submit, 'Create account');
    }
  });

  return () => {};
}

/* --------------------------------------------------------------- errors */

function handleAuthError(err, form, submit, defaultLabel) {
  setBusy(submit, false);
  if (!(err instanceof ApiError)) {
    toast('Unexpected error. Please try again.', { type: 'error' });
    return;
  }

  if (err.code === 'EMAIL_TAKEN') {
    setFieldError(form, 'email', err.message || 'That email is already registered.');
    toast(err.message || 'That email is already registered.', { type: 'error' });
    return;
  }
  if (err.code === 'INVALID_CREDENTIALS') {
    setFieldError(form, 'form', err.message || 'Incorrect email or password.');
    toast(err.message || 'Incorrect email or password.', { type: 'error', title: 'Sign in failed' });
    return;
  }
  if (err.code === 'VALIDATION_ERROR' && err.fieldErrors) {
    applyFieldErrors(form, err.fieldErrors);
    toast(err.message || 'Please fix the highlighted fields.', { type: 'error' });
    return;
  }
  if (err.code === 'NETWORK_ERROR') {
    setFieldError(form, 'form', err.message);
    toast(err.message, { type: 'error' });
    return;
  }
  setFieldError(form, 'form', err.message);
  toast(err.message || `${defaultLabel} failed. Please try again.`, { type: 'error' });
}
