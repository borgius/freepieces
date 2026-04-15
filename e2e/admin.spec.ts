import { test, expect, type Page } from '@playwright/test';

const BASE = '/admin/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(page: Page, username = 'admin', password = 'admin') {
  await page.goto(BASE);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait until the app shell is visible (nav bar)
  await expect(page.getByRole('heading', { name: 'Freepieces' })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /log.?out/i }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

test.describe('Login page', () => {
  test('shows the login form', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('heading', { name: 'Freepieces' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows an error for wrong credentials', async ({ page }) => {
    await page.goto(BASE);
    await page.getByLabel('Username').fill('wrong');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid|unauthorized|incorrect|failed/i)).toBeVisible();
  });

  test('logs in with correct credentials and shows app', async ({ page }) => {
    await login(page);
    // Should see the nav tabs
    await expect(page.getByRole('button', { name: /pieces/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Pieces page
// ---------------------------------------------------------------------------

test.describe('Pieces page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows list of registered pieces', async ({ page }) => {
    // Already on Pieces tab by default
    await expect(page.getByRole('heading', { name: 'Pieces' })).toBeVisible();
    // Wait for pieces to load (spinner disappears)
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    // At least one piece card should appear
    await expect(page.locator('[data-testid="piece-card"], .chakra-card, [class*="card"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows piece count summary', async ({ page }) => {
    await expect(page.getByText(/\d+ of \d+ enabled/i)).toBeVisible({ timeout: 10_000 });
  });

  test('has a working Refresh button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pieces' })).toBeVisible();
    const refresh = page.getByRole('button', { name: /refresh/i });
    await expect(refresh).toBeVisible();
    await refresh.click();
    // After refresh, still shows pieces
    await expect(page.getByText(/\d+ of \d+ enabled/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Add Piece page
// ---------------------------------------------------------------------------

test.describe('Add Piece page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: /add piece/i }).click();
  });

  test('shows install instructions', async ({ page }) => {
    await expect(page.getByText(/install|npm|piece/i).first()).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Docs page
// ---------------------------------------------------------------------------

test.describe('Docs page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Docs' }).click();
  });

  test('renders documentation content', async ({ page }) => {
    // Docs page should have at least some heading or text content
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Settings' }).click();
  });

  test('shows the Secrets section', async ({ page }) => {
    // Sidebar
    await expect(page.getByText('Secrets')).toBeVisible();
    // Wait for secrets panel to load
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
  });

  test('shows global infrastructure secrets', async ({ page }) => {
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    // Should list known global secret keys
    await expect(page.getByText(/ADMIN_USER|PUBLIC_URL|TOKEN_ENCRYPTION/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('shows set/missing status badges', async ({ page }) => {
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/set|missing/i).first()).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('Logout', () => {
  test('logs out and returns to login page', async ({ page }) => {
    await login(page);
    await logout(page);
    // Should not be on the app anymore
    await expect(page.getByRole('heading', { name: 'Freepieces' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
  });
});
