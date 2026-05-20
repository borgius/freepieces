/**
 * SMTP email sender for Linux deployments.
 *
 * Replaces the Cloudflare Email Workers binding used in `src/auth/email.ts`.
 * When SMTP_HOST is not configured, falls back to logging the code to console
 * so local dev works without any mail server.
 *
 * Usage: pass the returned function as the `sendCode` parameter to
 * `createAuthIssuer(env, storage, sendCode)`.
 */

import nodemailer from 'nodemailer';

export function createSmtpSender(): (email: string, code: string) => Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env['SMTP_HOST'],
    port: Number(process.env['SMTP_PORT'] ?? 587),
    secure: process.env['SMTP_SECURE'] === 'true',
    auth:
      process.env['SMTP_USER']
        ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] ?? '' }
        : undefined,
  });

  return async function sendCode(email: string, code: string): Promise<void> {
    const smtpHost = process.env['SMTP_HOST'];
    const from =
      process.env['FREEPIECES_AUTH_SENDER_EMAIL'] ??
      process.env['FP_AUTH_SENDER_EMAIL'] ??
      '';

    console.log(`[freepieces-auth] Verification code for ${email}: ${code}`);

    if (!smtpHost || !from) {
      return;
    }

    await transporter.sendMail({
      from: `Freepieces <${from}>`,
      to: email,
      subject: `Your verification code: ${code}`,
      text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
    });
  };
}
