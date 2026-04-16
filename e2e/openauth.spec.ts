/**
 * E2E tests proving the OpenAuth integration works.
 *
 * These tests verify:
 *   - Login page renders OpenAuth provider buttons (no username/password)
 *   - Login URL API returns correct authorization URLs for each provider
 *   - Protected admin routes enforce session auth (401 without cookies)
 *   - The /admin/api/callback validates parameters correctly
 *   - Logout endpoint works
 *   - OpenAuth issuer discovery endpoint responds
 *   - Clicking sign-in buttons initiates the correct provider flow
 *
 * Tests use the Vite proxy (localhost:5433) for /admin/api/* routes
 * and the worker directly (localhost:9321) for /oa/* and /health routes.
 */

import { test, expect } from '@playwright/test';

const WORKER_URL = 'http://localhost:9321';
const ADMIN_BASE = '/admin/';

// ---------------------------------------------------------------------------
// Login page — verify OpenAuth UI
// ---------------------------------------------------------------------------

test.describe('OpenAuth login page', () => {
  test('shows three sign-in provider buttons', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await expect(page.getByRole('button', { name: /sign in with email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with github/i })).toBeVisible();
  });

  test('does NOT show username or password fields', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await expect(page.getByLabel('Username')).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
  });

  test('shows Freepieces heading and Admin Console subtitle', async ({ page }) => {
    await page.goto(ADMIN_BASE);
    await expect(page.getByRole('heading', { name: 'Freepieces' })).toBeVisible();
    await expect(page.getByText('Admin Console')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Login URL API — correct authorization URLs for each provider
// ---------------------------------------------------------------------------

test.describe('OpenAuth login URL API', () => {
  test('returns code provider authorize URL with correct params', async ({ request }) => {
    const res = await request.get('/admin/api/login-url?provider=code');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.url).toBeTruthy();

    const url = new URL(body.url);
    expect(url.pathname).toBe('/oa/authorize');
    expect(url.searchParams.get('provider')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('freepieces-worker');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toContain('/admin/api/callback');
  });

  test('returns google provider authorize URL', async ({ request }) => {
    const res = await request.get('/admin/api/login-url?provider=google');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const url = new URL(body.url);
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('client_id')).toBe('freepieces-worker');
  });

  test('returns github provider authorize URL', async ({ request }) => {
    const res = await request.get('/admin/api/login-url?provider=github');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const url = new URL(body.url);
    expect(url.searchParams.get('provider')).toBe('github');
    expect(url.searchParams.get('client_id')).toBe('freepieces-worker');
  });

  test('defaults to code provider when no provider query param', async ({ request }) => {
    const res = await request.get('/admin/api/login-url');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const url = new URL(body.url);
    expect(url.searchParams.get('provider')).toBe('code');
  });
});

// ---------------------------------------------------------------------------
// Session enforcement — protected routes reject unauthenticated requests
// ---------------------------------------------------------------------------

test.describe('OpenAuth session enforcement', () => {
  test('GET /admin/api/me returns 401 without session', async ({ request }) => {
    const res = await request.get('/admin/api/me');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('GET /admin/api/pieces returns 401 without session', async ({ request }) => {
    const res = await request.get('/admin/api/pieces');
    expect(res.status()).toBe(401);
  });

  test('GET /admin/api/secrets returns 401 without session', async ({ request }) => {
    const res = await request.get('/admin/api/secrets');
    expect(res.status()).toBe(401);
  });

  test('POST /admin/api/pieces/gmail/install returns 401 without session', async ({ request }) => {
    const res = await request.post('/admin/api/pieces/gmail/install');
    expect(res.status()).toBe(401);
  });

  test('DELETE /admin/api/pieces/gmail returns 401 without session', async ({ request }) => {
    const res = await request.delete('/admin/api/pieces/gmail');
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Callback endpoint validation
// ---------------------------------------------------------------------------

test.describe('OpenAuth callback validation', () => {
  test('returns 400 when code parameter is missing', async ({ request }) => {
    const res = await request.get('/admin/api/callback');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing code/i);
  });

  test('returns 401 for an invalid authorization code', async ({ request }) => {
    const res = await request.get('/admin/api/callback?code=invalid-bogus-code');
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('OpenAuth logout', () => {
  test('POST /admin/api/logout succeeds even without a session', async ({ request }) => {
    const res = await request.post('/admin/api/logout');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OpenAuth issuer endpoints (hit the worker directly at :9321)
// ---------------------------------------------------------------------------

test.describe('OpenAuth issuer', () => {
  test('discovery endpoint responds with server metadata', async ({ request }) => {
    const res = await request.get(
      `${WORKER_URL}/oa/.well-known/oauth-authorization-server`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBeTruthy();
    expect(body.authorization_endpoint).toBeTruthy();
    expect(body.token_endpoint).toBeTruthy();
  });

  test('authorize endpoint accepts code provider', async ({ request }) => {
    const redirectUri = encodeURIComponent(`${WORKER_URL}/admin/api/callback`);
    const res = await request.get(
      `${WORKER_URL}/oa/authorize?client_id=freepieces-worker&redirect_uri=${redirectUri}&response_type=code&provider=code`,
      { maxRedirects: 0 },
    );
    // OpenAuth redirects to its built-in code UI
    expect([200, 302]).toContain(res.status());
  });

  test('worker /health endpoint is still accessible', async ({ request }) => {
    const res = await request.get(`${WORKER_URL}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('freepieces');
  });

  test('worker /pieces public endpoint is still accessible', async ({ request }) => {
    const res = await request.get(`${WORKER_URL}/pieces`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sign-in flow initiation — buttons trigger the correct provider
// ---------------------------------------------------------------------------

test.describe('OpenAuth sign-in flow', () => {
  test('email button fetches login URL with code provider', async ({ page }) => {
    await page.goto(ADMIN_BASE);

    // Intercept the login-url call and capture the body before navigation occurs
    let capturedUrl = '';
    await page.route('**/admin/api/login-url**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      capturedUrl = body.url;
      // Abort navigation by fulfilling with the same body but not navigating
      await route.fulfill({ response });
    });

    await page.getByRole('button', { name: /sign in with email/i }).click();
    await expect.poll(() => capturedUrl).toBeTruthy();
    expect(new URL(capturedUrl).searchParams.get('provider')).toBe('code');
  });

  test('google button fetches login URL with google provider', async ({ page }) => {
    await page.goto(ADMIN_BASE);

    let capturedUrl = '';
    await page.route('**/admin/api/login-url**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      capturedUrl = body.url;
      await route.fulfill({ response });
    });

    await page.getByRole('button', { name: /sign in with google/i }).click();
    await expect.poll(() => capturedUrl).toBeTruthy();
    expect(new URL(capturedUrl).searchParams.get('provider')).toBe('google');
  });

  test('github button fetches login URL with github provider', async ({ page }) => {
    await page.goto(ADMIN_BASE);

    let capturedUrl = '';
    await page.route('**/admin/api/login-url**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      capturedUrl = body.url;
      await route.fulfill({ response });
    });

    await page.getByRole('button', { name: /sign in with github/i }).click();
    await expect.poll(() => capturedUrl).toBeTruthy();
    expect(new URL(capturedUrl).searchParams.get('provider')).toBe('github');
  });
});
