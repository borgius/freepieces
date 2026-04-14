import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stub global fetch BEFORE importing the module ───────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after the global stub is in place
const { gmailPiece } = await import('./gmail');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockEnv = {
  FREEPIECES_PUBLIC_URL: 'https://freepieces.test',
  TOKEN_STORE: {} as unknown as KVNamespace,
  OAUTH_CLIENT_ID: 'generic-id',
  OAUTH_CLIENT_SECRET: 'generic-secret',
  TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  GMAIL_CLIENT_ID: '991527111173-test.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET: 'GOCSPX-test',
};

const mockAuth = {
  accessToken: 'ya29.test-access-token',
  refreshToken: 'test-refresh-token',
  tokenType: 'Bearer',
  scope: 'https://mail.google.com/',
};

function okJson(data: unknown) {
  return {
    ok: true, status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}
function errResponse(status: number, body: string) {
  return { ok: false, status, json: () => Promise.reject(new Error(body)), text: () => Promise.resolve(body) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('gmailPiece definition', () => {
  it('has the correct name and displayName', () => {
    expect(gmailPiece.name).toBe('gmail');
    expect(gmailPiece.displayName).toBe('Gmail');
  });

  it('uses oauth2 auth with Google URLs', () => {
    expect(gmailPiece.auth.type).toBe('oauth2');
    if (gmailPiece.auth.type === 'oauth2') {
      expect(gmailPiece.auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/auth');
      expect(gmailPiece.auth.tokenUrl).toBe('https://oauth2.googleapis.com/token');
      expect(gmailPiece.auth.scopes).toContain('https://mail.google.com/');
    }
  });

  it('uses Gmail-specific credential env keys', () => {
    if (gmailPiece.auth.type === 'oauth2') {
      expect(gmailPiece.auth.clientIdEnvKey).toBe('GMAIL_CLIENT_ID');
      expect(gmailPiece.auth.clientSecretEnvKey).toBe('GMAIL_CLIENT_SECRET');
    }
  });

  it('exposes all 7 actions', () => {
    const names = gmailPiece.actions.map((a) => a.name);
    expect(names).toContain('send_email');
    expect(names).toContain('request_approval_in_mail');
    expect(names).toContain('reply_to_email');
    expect(names).toContain('create_draft_reply');
    expect(names).toContain('gmail_get_mail');
    expect(names).toContain('gmail_search_mail');
    expect(names).toContain('custom_api_call');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('send_email action', () => {
  beforeEach(() => mockFetch.mockReset());

  it('calls Gmail API with Authorization Bearer header', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ emailAddress: 'sender@gmail.com' })) // getUserEmail
      .mockResolvedValueOnce(okJson({ id: 'msg-123', threadId: 'thread-123' })); // send

    const action = gmailPiece.actions.find((a) => a.name === 'send_email')!;
    await action.run({
      auth: mockAuth,
      props: { receiver: ['to@example.com'], subject: 'Hello', body: 'Body', body_type: 'plain_text' },
      env: mockEnv as never,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [sendUrl, sendInit] = mockFetch.mock.calls[1];
    expect(sendUrl).toContain('/messages/send');
    expect((sendInit.headers as Record<string, string>)['Authorization']).toBe('Bearer ya29.test-access-token');
    const body = JSON.parse(sendInit.body as string);
    expect(body.raw).toBeTruthy(); // base64url-encoded raw email
  });

  it('creates a draft when draft=true', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ emailAddress: 'sender@gmail.com' }))
      .mockResolvedValueOnce(okJson({ id: 'draft-id' }));

    const action = gmailPiece.actions.find((a) => a.name === 'send_email')!;
    await action.run({
      auth: mockAuth,
      props: { receiver: ['to@example.com'], subject: 'Draft', body: 'Body', body_type: 'plain_text', draft: true },
      env: mockEnv as never,
    });

    const [draftUrl] = mockFetch.mock.calls[1];
    expect(draftUrl).toContain('/drafts');
  });

  it('throws when access token is missing', async () => {
    const action = gmailPiece.actions.find((a) => a.name === 'send_email')!;
    await expect(
      action.run({ auth: {}, props: { receiver: ['x@y.com'], subject: 'T', body: 'T', body_type: 'plain_text' }, env: mockEnv as never })
    ).rejects.toThrow('No access token available');
  });

  it('propagates Gmail API errors', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ emailAddress: 'sender@gmail.com' }))
      .mockResolvedValueOnce(errResponse(403, 'Forbidden'));

    const action = gmailPiece.actions.find((a) => a.name === 'send_email')!;
    await expect(
      action.run({ auth: mockAuth, props: { receiver: ['x@y.com'], subject: 'T', body: 'T', body_type: 'plain_text' }, env: mockEnv as never })
    ).rejects.toThrow('Gmail API error 403');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('gmail_search_mail action', () => {
  beforeEach(() => mockFetch.mockReset());

  it('builds a query and returns found results', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ messages: [{ id: 'msg1' }, { id: 'msg2' }] }))
      .mockResolvedValueOnce(okJson({ id: 'msg1', payload: { headers: [{ name: 'Subject', value: 'Invoice' }], parts: [] }, snippet: 'inv' }))
      .mockResolvedValueOnce(okJson({ id: 'msg2', payload: { headers: [], parts: [] }, snippet: '' }));

    const action = gmailPiece.actions.find((a) => a.name === 'gmail_search_mail')!;
    const result = await action.run({
      auth: mockAuth,
      props: { subject: 'Invoice', max_results: 5 },
      env: mockEnv as never,
    }) as { found: boolean; results: { count: number } };

    const [searchUrl] = mockFetch.mock.calls[0];
    expect(decodeURIComponent(searchUrl as string)).toContain('subject:(Invoice)');
    expect(result.found).toBe(true);
    expect(result.results.count).toBe(2);
  });

  it('returns found=false when no messages', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ messages: [] }));
    const action = gmailPiece.actions.find((a) => a.name === 'gmail_search_mail')!;
    const result = await action.run({
      auth: mockAuth,
      props: { from: 'nobody@example.com' },
      env: mockEnv as never,
    }) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it('throws when no search criteria provided', async () => {
    const action = gmailPiece.actions.find((a) => a.name === 'gmail_search_mail')!;
    await expect(
      action.run({ auth: mockAuth, props: {}, env: mockEnv as never })
    ).rejects.toThrow('Please provide at least one search criterion');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('gmail_get_mail action', () => {
  beforeEach(() => mockFetch.mockReset());

  it('fetches message by id and parses headers and body', async () => {
    // Gmail API returns base64url-encoded body data; btoa produces standard base64,
    // which our decoder also handles (the replace ops are no-ops for standard base64).
    mockFetch.mockResolvedValueOnce(okJson({
      id: 'msg-abc',
      threadId: 'thread-abc',
      snippet: 'Hello world',
      payload: {
        headers: [
          { name: 'From', value: 'alice@example.com' },
          { name: 'Subject', value: 'Test Email' },
        ],
        parts: [{ mimeType: 'text/plain', body: { data: btoa('Hello World') } }],
      },
    }));

    const action = gmailPiece.actions.find((a) => a.name === 'gmail_get_mail')!;
    const result = await action.run({
      auth: mockAuth,
      props: { message_id: 'msg-abc' },
      env: mockEnv as never,
    }) as Record<string, string>;

    const [getUrl] = mockFetch.mock.calls[0];
    expect(getUrl).toContain('/messages/msg-abc');
    expect(result.from).toBe('alice@example.com');
    expect(result.subject).toBe('Test Email');
    expect(result.body_text).toBe('Hello World');
  });
});


