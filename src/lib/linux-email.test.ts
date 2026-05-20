import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture createTransport mock factory before module import
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const mockCreateTransport = vi.fn().mockReturnValue({ sendMail: mockSendMail });

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

// Import after mocks are registered
const { createSmtpSender } = await import('./linux-email');

describe('createSmtpSender', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to original state
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('logs to console when SMTP_HOST is not set (fallback mode)', async () => {
    delete process.env['SMTP_HOST'];
    delete process.env['FREEPIECES_AUTH_SENDER_EMAIL'];

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sendCode = createSmtpSender();

    await sendCode('user@example.com', '123456');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('123456'),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('logs to console when FREEPIECES_AUTH_SENDER_EMAIL is not set', async () => {
    process.env['SMTP_HOST'] = 'smtp.example.com';
    delete process.env['FREEPIECES_AUTH_SENDER_EMAIL'];
    delete process.env['FP_AUTH_SENDER_EMAIL'];

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sendCode = createSmtpSender();

    await sendCode('user@example.com', '999');

    expect(consoleSpy).toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('calls sendMail with correct fields when SMTP is configured', async () => {
    process.env['SMTP_HOST'] = 'smtp.example.com';
    process.env['SMTP_PORT'] = '587';
    process.env['SMTP_SECURE'] = 'false';
    process.env['SMTP_USER'] = 'noreply@example.com';
    process.env['SMTP_PASS'] = 'secret';
    process.env['FREEPIECES_AUTH_SENDER_EMAIL'] = 'noreply@example.com';

    const sendCode = createSmtpSender();
    await sendCode('recipient@example.com', '654321');

    expect(mockSendMail).toHaveBeenCalledOnce();
    const mailArgs = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs['to']).toBe('recipient@example.com');
    expect(mailArgs['subject']).toContain('654321');
    expect(String(mailArgs['from'])).toContain('noreply@example.com');
  });

  it('uses FP_AUTH_SENDER_EMAIL as fallback sender', async () => {
    process.env['SMTP_HOST'] = 'smtp.example.com';
    process.env['FP_AUTH_SENDER_EMAIL'] = 'fp@example.com';
    delete process.env['FREEPIECES_AUTH_SENDER_EMAIL'];

    const sendCode = createSmtpSender();
    await sendCode('someone@example.com', '111');

    expect(mockSendMail).toHaveBeenCalledOnce();
    const mailArgs = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(String(mailArgs['from'])).toContain('fp@example.com');
  });
});
