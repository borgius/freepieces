import { test, expect, type Page } from '@playwright/test';

const BASE = '/admin/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock the admin API session endpoints so the SPA renders the authenticated
 * app shell.  The real OpenAuth flow is tested in openauth.spec.ts; here we
 * just need the UI to believe the user is logged in.
 */
async function mockAuthenticatedSession(page: Page) {
  // /admin/api/me — tells the SPA we have a valid session
  await page.route('**/admin/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'admin@test.local' }),
    }),
  );

  // /admin/api/pieces — minimal piece fixture so the Pieces page renders
  await page.route('**/admin/api/pieces', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          name: 'gmail',
          displayName: 'Gmail',
          description: 'Send and read emails with Gmail',
          version: '0.1.0',
          auth: { type: 'oauth2' },
          actions: [{ name: 'send-email', displayName: 'Send Email', description: null, props: null }],
          triggers: [],
          secrets: [],
          supportsUsers: true,
          hasAutoUserId: true,
          enabled: true,
        },
        {
          name: 'example-apikey',
          displayName: 'Example API Key',
          description: 'Example piece using API key auth',
          version: '0.1.0',
          auth: { type: 'apikey' },
          actions: [],
          triggers: [],
          secrets: [],
          supportsUsers: false,
          hasAutoUserId: false,
          enabled: false,
        },
      ]),
    }),
  );

  // /admin/api/secrets — minimal secrets fixture
  await page.route('**/admin/api/secrets', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        global: [
          { key: 'FREEPIECES_PUBLIC_URL', displayName: 'Public URL', description: '', required: true, isSet: true, command: 'wrangler secret put FREEPIECES_PUBLIC_URL' },
          { key: 'RUN_API_KEY', displayName: 'Runtime API Key', description: '', required: false, isSet: false, command: 'wrangler secret put RUN_API_KEY' },
          { key: 'TOKEN_ENCRYPTION_KEY', displayName: 'Token Encryption Key', description: '', required: true, isSet: true, command: 'wrangler secret put TOKEN_ENCRYPTION_KEY' },
          { key: 'ADMIN_EMAILS', displayName: 'Admin Emails', description: '', required: true, isSet: true, command: 'wrangler secret put ADMIN_EMAILS' },
        ],
        pieces: [],
      }),
    }),
  );

  // /admin/api/logout
  await page.route('**/admin/api/logout', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
}

/** Navigate to the admin UI with a mocked authenticated session. */
async function loginMocked(page: Page) {
  await mockAuthenticatedSession(page);
  await page.goto(BASE);
  // Wait until the app shell is visible (nav bar)
  await expect(page.getByRole('heading', { name: 'Freepieces' })).toBeVisible();
  // Wait for pieces tab to appear (proves we're past the login screen)
  await expect(page.getByRole('button', { name: /pieces/i }).first()).toBeVisible();
}

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

test.describe('Login page', () => {
  test('shows OpenAuth sign-in buttons', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('heading', { name: 'Freepieces' })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with github/i })).toBeVisible();
  });

  test('does not show username or password fields', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByLabel('Username')).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Pieces page
// ---------------------------------------------------------------------------

test.describe('Pieces page', () => {
  test.beforeEach(async ({ page }) => {
    await loginMocked(page);
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
    await loginMocked(page);
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
    await loginMocked(page);
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
    await loginMocked(page);
    await page.getByRole('button', { name: 'Settings' }).click();
  });

  test('shows the Secrets section', async ({ page }) => {
    // Sidebar nav button
    await expect(page.getByRole('button', { name: 'Secrets' })).toBeVisible();
    // Wait for secrets panel to load
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
  });

  test('shows global infrastructure secrets', async ({ page }) => {
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    // Should list known global secret keys
    await expect(page.getByText(/ADMIN_EMAILS|PUBLIC_URL|TOKEN_ENCRYPTION/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('shows set/missing status badges', async ({ page }) => {
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/set|missing/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('shows the Triggers sidebar item', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Triggers' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Settings → Triggers panel
// ---------------------------------------------------------------------------

test.describe('Settings → Triggers panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginMocked(page);
    await page.getByRole('button', { name: 'Settings' }).click();
  });

  test('shows Triggers heading when Triggers tab is selected', async ({ page }) => {
    // Mock the groups endpoint before navigating
    await page.route('**/admin/api/triggers/groups', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ groups: [] }),
      }),
    );
    await page.getByRole('button', { name: 'Triggers' }).click();
    await expect(page.getByRole('heading', { name: 'Triggers' })).toBeVisible({ timeout: 8_000 });
  });

  test('shows empty state when there are no subscriptions', async ({ page }) => {
    await page.route('**/admin/api/triggers/groups', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ groups: [] }),
      }),
    );
    await page.getByRole('button', { name: 'Triggers' }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/no active trigger subscriptions|no trigger subscriptions/i)).toBeVisible({ timeout: 8_000 });
  });

  test('shows grouped endpoint rows when subscriptions exist', async ({ page }) => {
    await page.route('**/admin/api/triggers/groups', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              endpointKey: 'callbackUrl:https://my-server.example.com/hook',
              endpointType: 'callbackUrl',
              endpointValue: 'https://my-server.example.com/hook',
              memberCount: 2,
              members: [
                {
                  subscriptionId: 'sub-1',
                  pieceName: 'test-piece',
                  pieceDisplayName: 'Test Piece',
                  triggerName: 'new-event',
                  triggerDisplayName: 'New Event',
                  triggerType: 'WEBHOOK',
                  providerWebhookUrl: 'https://worker.example.com/webhook/test-piece',
                  createdAt: '2026-05-01T00:00:00.000Z',
                  owner: { kind: 'direct-token', label: 'API key / direct token', ownerKey: 'token:sub-1' },
                  deliveryTarget: { type: 'callbackUrl', value: 'https://my-server.example.com/hook' },
                },
                {
                  subscriptionId: 'sub-2',
                  pieceName: 'test-piece',
                  pieceDisplayName: 'Test Piece',
                  triggerName: 'new-event',
                  triggerDisplayName: 'New Event',
                  triggerType: 'WEBHOOK',
                  providerWebhookUrl: 'https://worker.example.com/webhook/test-piece',
                  createdAt: '2026-05-02T00:00:00.000Z',
                  owner: { kind: 'stored-user', label: 'alice@example.com', ownerKey: 'oauth:alice@example.com' },
                  deliveryTarget: { type: 'callbackUrl', value: 'https://my-server.example.com/hook' },
                },
              ],
            },
            {
              endpointKey: 'queueName:events-queue',
              endpointType: 'queueName',
              endpointValue: 'events-queue',
              memberCount: 1,
              members: [
                {
                  subscriptionId: 'sub-3',
                  pieceName: 'test-piece',
                  pieceDisplayName: 'Test Piece',
                  triggerName: 'new-event',
                  triggerDisplayName: 'New Event',
                  triggerType: 'WEBHOOK',
                  providerWebhookUrl: 'https://worker.example.com/webhook/test-piece',
                  createdAt: '2026-05-03T00:00:00.000Z',
                  owner: { kind: 'stored-user', label: 'bob@example.com', ownerKey: 'oauth:bob@example.com' },
                  deliveryTarget: { type: 'queueName', value: 'events-queue' },
                },
              ],
            },
          ],
        }),
      }),
    );

    await page.getByRole('button', { name: 'Triggers' }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });

    // Should show the two endpoint groups
    await expect(page.getByText('https://my-server.example.com/hook')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('events-queue')).toBeVisible({ timeout: 8_000 });

    // Should show member counts
    await expect(page.getByText(/2 triggers/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/1 trigger/i)).toBeVisible({ timeout: 8_000 });

    // Should show HTTPS callback and Cloudflare Queue type badges
    await expect(page.getByText(/HTTPS callback/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/Cloudflare Queue/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('expanding a group reveals member metadata', async ({ page }) => {
    await page.route('**/admin/api/triggers/groups', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              endpointKey: 'callbackUrl:https://expand-test.example.com/hook',
              endpointType: 'callbackUrl',
              endpointValue: 'https://expand-test.example.com/hook',
              memberCount: 1,
              members: [
                {
                  subscriptionId: 'sub-expand-1',
                  pieceName: 'slack',
                  pieceDisplayName: 'Slack',
                  triggerName: 'new-message',
                  triggerDisplayName: 'New Message',
                  triggerType: 'APP_WEBHOOK',
                  providerWebhookUrl: 'https://worker.example.com/webhook/slack',
                  createdAt: '2026-05-10T12:00:00.000Z',
                  owner: { kind: 'stored-user', label: 'charlie@example.com', ownerKey: 'oauth:charlie@example.com' },
                  deliveryTarget: { type: 'callbackUrl', value: 'https://expand-test.example.com/hook' },
                },
              ],
            },
          ],
        }),
      }),
    );

    await page.getByRole('button', { name: 'Triggers' }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });

    // Click the group row to expand it
    await page.getByText('https://expand-test.example.com/hook').click();

    // Member metadata should now be visible
    await expect(page.getByText('Slack')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('New Message')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('charlie@example.com')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('https://worker.example.com/webhook/slack')).toBeVisible({ timeout: 8_000 });
  });

  test('Refresh button reloads trigger groups', async ({ page }) => {
    let callCount = 0;
    await page.route('**/admin/api/triggers/groups', (route) => {
      callCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ groups: [] }),
      });
    });

    await page.getByRole('button', { name: 'Triggers' }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });

    const countBefore = callCount;
    await page.getByRole('button', { name: /refresh/i }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    expect(callCount).toBeGreaterThan(countBefore);
  });

  test('shows summary line with endpoint and subscription counts', async ({ page }) => {
    await page.route('**/admin/api/triggers/groups', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            { endpointKey: 'callbackUrl:https://a.example.com/', endpointType: 'callbackUrl', endpointValue: 'https://a.example.com/', memberCount: 3, members: [] },
            { endpointKey: 'queueName:my-q', endpointType: 'queueName', endpointValue: 'my-q', memberCount: 1, members: [] },
          ],
        }),
      }),
    );

    await page.getByRole('button', { name: 'Triggers' }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });

    // Summary: 2 delivery endpoints, 4 subscriptions total
    await expect(page.getByText(/2 delivery endpoint/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/4 subscription/i)).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test.describe('Logout', () => {
  test('logs out and returns to login page', async ({ page }) => {
    await loginMocked(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Should return to login screen with sign-in buttons
    await expect(page.getByRole('button', { name: /sign in with email/i })).toBeVisible();
  });
});
