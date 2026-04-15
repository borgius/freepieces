/** Cloudflare Workers entrypoint for freepieces. */

import { listPieces, getPiece, getTrigger } from './framework/registry';
import { buildCallbackUrl } from './framework/auth';
import {
  buildLoginUrl,
  handleCallback,
  resolveOAuthClientCredentials,
} from './lib/oauth';
import { storeToken } from './lib/token-store';
import { createSessionToken, timingSafeEqual } from './lib/admin-session';
import { resolveRuntimeRequestAuth } from './lib/request-auth';
import { buildApContext, buildApTriggerContext } from './lib/ap-context';
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth } from './lib/auth-resolve';
import {
  dispatchWebhook,
  listSubscriptions,
  verifySlackSignature,
  resolveQueueBinding,
  sameSubscriptionOwner,
  SUB_KEY,
} from './lib/webhook';
import type { WebhookSubscription } from './lib/webhook';
import { requireAdminSession, buildCookie } from './lib/admin-config';
import { handleAdminApi } from './routes/admin-api';
import './pieces/index.js';
import type { Env, OAuth2AuthDefinition, PieceTriggerContext } from './framework/types';

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...((init.headers as Record<string, string>) ?? {})
    }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // ── Health ──────────────────────────────────────────────────────────────
    if (pathname === '/health') {
      return json({ ok: true, service: 'freepieces', version: '0.1.0' });
    }

    // ── List pieces ─────────────────────────────────────────────────────────
    if (pathname === '/pieces') {
      return json(
        listPieces().map((p) => ({
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          version: p.version,
          auth: p.auth,
          actions: p.actions.map((a) => ({
            name: a.name,
            displayName: a.displayName,
            description: a.description
          })),
          triggers: p.triggers.map((t) => ({
            name: t.name,
            displayName: t.displayName,
            description: t.description,
            type: t.type,
          })),
        }))
      );
    }

    // ── OAuth2 login start ───────────────────────────────────────────────────
    if (pathname.startsWith('/auth/login/')) {
      const pieceName = pathname.slice('/auth/login/'.length);
      const stored = getPiece(pieceName);
      if (!stored) return json({ error: 'Piece not found' }, { status: 404 });
      if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
        return json({ error: 'Piece does not use OAuth2' }, { status: 400 });
      }

      const userId = url.searchParams.get('userId');
      if (!userId) return json({ error: 'Missing userId query parameter' }, { status: 400 });

      const callbackUrl = buildCallbackUrl(env.FREEPIECES_PUBLIC_URL, pieceName);
      const authDef = stored.def.auth as OAuth2AuthDefinition;
      let clientId: string;
      try {
        ({ clientId } = resolveOAuthClientCredentials(authDef, env));
      } catch (err) {
        return json(
          { error: err instanceof Error ? err.message : 'OAuth client credentials not configured' },
          { status: 503 },
        );
      }
      const loginUrl = await buildLoginUrl(authDef, {
        pieceName,
        callbackUrl,
        clientId,
        encryptionKey: env.TOKEN_ENCRYPTION_KEY,
        userId
      });

      return Response.redirect(loginUrl, 302);
    }

    // ── OAuth2 callback ──────────────────────────────────────────────────────
    if (pathname.startsWith('/auth/callback/')) {
      const pieceName = pathname.slice('/auth/callback/'.length);
      const stored = getPiece(pieceName);
      if (!stored) return json({ error: 'Piece not found' }, { status: 404 });
      if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
        return json({ error: 'Piece does not use OAuth2' }, { status: 400 });
      }

      try {
        const callbackUrl = buildCallbackUrl(env.FREEPIECES_PUBLIC_URL, pieceName);
        const { userId } = await handleCallback(
          url.searchParams,
          stored.def.auth as OAuth2AuthDefinition,
          env,
          callbackUrl
        );
        return json({
          ok: true,
          message: 'Token stored successfully. You may close this window.',
          userId
        });
      } catch (err) {
        // Log internally; return a safe, non-leaking message to the caller.
        console.error('[freepieces] OAuth callback error:', err);
        const status =
          err instanceof Error && err.message.startsWith('Missing OAuth client credentials')
            ? 503
            : 400;
        const isKnownError =
          err instanceof Error &&
          (err.message.startsWith('Missing') ||
            err.message.startsWith('Invalid') ||
            err.message.startsWith('Token exchange'));
        const message = isKnownError && err instanceof Error
          ? err.message
          : 'OAuth callback failed';
        return json({ error: message }, { status });
      }
    }

    // ── Run action ───────────────────────────────────────────────────────────
    if (pathname.startsWith('/run/')) {
      const segments = pathname.slice('/run/'.length).split('/');
      if (segments.length < 2) {
        return json({ error: 'Expected /run/:piece/:action' }, { status: 400 });
      }
      const [pieceName, actionName] = segments;
      const stored = getPiece(pieceName);
      if (!stored) {
        return json({ error: 'Action not found' }, { status: 404 });
      }

      const authResult = resolveRuntimeRequestAuth(request.headers, env.RUN_API_KEY);
      if (!authResult.ok) {
        return json({ error: authResult.error }, { status: authResult.status });
      }
      const { userId, pieceToken, pieceAuthProps } = authResult.credentials;

      let auth: Record<string, string> | undefined;

      // Parse request body
      let props: Record<string, unknown> = {};
      if (request.method === 'POST') {
        try {
          props = (await request.json()) as Record<string, unknown>;
        } catch {
          // non-JSON body is fine; props stay empty
        }
      }

      try {
        let result: unknown;

        if (stored.kind === 'native') {
          // ── Freepieces native piece ─────────────────────────────────────
          const piece = stored.def;
          const action = piece.actions.find((a) => a.name === actionName);
          if (!action) {
            return json({ error: 'Action not found' }, { status: 404 });
          }

          auth = await resolveNativeRuntimeAuth(pieceName, piece.auth, env, userId, pieceToken);
          if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };

          result = await action.run({ auth, props, env });

        } else {
          // ── Activepieces native piece ───────────────────────────────────
          const { piece } = stored;
          const action = piece._actions[actionName];
          if (!action) {
            return json({ error: 'Action not found' }, { status: 404 });
          }

          auth = await resolveApRuntimeAuth(pieceName, piece, env, userId, pieceToken);
          if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };

          const apCtx = buildApContext(pieceName, piece, auth, props, env);
          result = await action.run(apCtx);
        }

        return json({ ok: true, result });
      } catch (err) {
        // Log the real error server-side; never expose internal details to callers.
        console.error(`[freepieces] Action ${pieceName}/${actionName} failed:`, err);
        return json({ ok: false, error: 'Action execution failed' }, { status: 500 });
      }
    }

    // ── Run trigger (receive webhook payload, invoke trigger filter) ─────────
    if (pathname.startsWith('/trigger/')) {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, { status: 405 });
      }
      const segments = pathname.slice('/trigger/'.length).split('/');
      if (segments.length < 2) {
        return json({ error: 'Expected /trigger/:piece/:trigger' }, { status: 400 });
      }
      const [pieceName, triggerName] = segments;

      const stored = getPiece(pieceName);
      if (!stored) return json({ error: 'Piece not found' }, { status: 404 });

      const trigger = getTrigger(pieceName, triggerName);
      if (!trigger) return json({ error: 'Trigger not found' }, { status: 404 });

      let body: { payload?: unknown; propsValue?: Record<string, unknown> } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const authResult = resolveRuntimeRequestAuth(request.headers, env.RUN_API_KEY);
      if (!authResult.ok) {
        return json({ error: authResult.error }, { status: authResult.status });
      }
      const { userId, pieceToken, pieceAuthProps } = authResult.credentials;

      try {
        // ── Native piece trigger ────────────────────────────────────────────
        if (stored.kind === 'native') {
          const nativeTrigger = stored.def.triggers?.find((t) => t.name === triggerName);
          if (!nativeTrigger) return json({ error: 'Trigger not found' }, { status: 404 });

          let nativeAuth = await resolveNativeRuntimeAuth(pieceName, stored.def.auth, env, userId, pieceToken);
          if (pieceAuthProps) nativeAuth = { ...nativeAuth, ...pieceAuthProps };

          const nativeCtx: PieceTriggerContext = {
            auth: nativeAuth,
            props: body.propsValue ?? {},
            lastPollMs: typeof (body as Record<string, unknown>).lastPollMs === 'number'
              ? (body as Record<string, unknown>).lastPollMs as number
              : 0,
            env,
          };
          const events = await nativeTrigger.run(nativeCtx);
          return json({ ok: true, events });
        }

        // ── AP piece trigger ────────────────────────────────────────────────
        if (stored.kind !== 'ap') {
          return json({ error: 'Piece does not support triggers' }, { status: 400 });
        }

        let auth = await resolveApRuntimeAuth(pieceName, stored.piece, env, userId, pieceToken);
        if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };
        const ctx = buildApTriggerContext(
          pieceName,
          stored.piece,
          auth,
          body.propsValue ?? {},
          body.payload ?? {},
          env,
        );
        const events = await (trigger as { run(ctx: unknown): Promise<unknown[]> }).run(ctx);
        return json({ ok: true, events });
      } catch (err) {
        console.error(`[freepieces] Trigger ${pieceName}/${triggerName} failed:`, err);
        return json({ ok: false, error: 'Trigger execution failed' }, { status: 500 });
      }
    }

    // ── Admin SPA ────────────────────────────────────────────────────────────
    // Redirect bare /admin → /admin/ so asset-relative paths resolve correctly.
    if (pathname === '/admin') {
      return Response.redirect(new URL('/admin/', request.url).toString(), 301);
    }

    // Serve the React admin SPA shell for all non-API admin paths.
    if (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/api/')) {
      if (!env.ASSETS) {
        return json({ error: 'Admin assets not configured. Run: npm run build:admin' }, { status: 503 });
      }
      // Rewrite unknown deep paths to index.html for client-side SPA routing.
      const assetPath = pathname.startsWith('/admin/assets/')
        ? pathname
        : '/admin/index.html';
      return env.ASSETS.fetch(new Request(new URL(assetPath, request.url).toString(), request));
    }

    // ── Admin API – unauthenticated ──────────────────────────────────────────
    if (pathname === '/admin/api/login' && request.method === 'POST') {
      if (!env.ADMIN_USER || !env.ADMIN_PASSWORD || !env.ADMIN_SIGNING_KEY) {
        return json({ error: 'Admin credentials not configured' }, { status: 503 });
      }
      let body: { username?: string; password?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const { username = '', password = '' } = body;
      const validUser = timingSafeEqual(username, env.ADMIN_USER);
      const validPass = timingSafeEqual(password, env.ADMIN_PASSWORD);
      if (!validUser || !validPass) {
        return json({ error: 'Invalid credentials' }, { status: 401 });
      }
      const token = await createSessionToken(username, env.ADMIN_SIGNING_KEY);
      const isSecure = request.url.startsWith('https://');
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': buildCookie(token, isSecure, 86400)
        }
      });
    }

    if (pathname === '/admin/api/logout' && request.method === 'POST') {
      const isSecure = request.url.startsWith('https://');
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': buildCookie('', isSecure, 0)
        }
      });
    }

    // ── Admin API – authenticated ────────────────────────────────────────────
    if (pathname.startsWith('/admin/api/')) {
      const session = await requireAdminSession(request, env);
      if (!session) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      // GET /admin/api/me
      if (pathname === '/admin/api/me' && request.method === 'GET') {
        return json({ username: session.sub });
      }

      const adminResponse = await handleAdminApi(pathname, request, env, json);
      if (adminResponse) return adminResponse;

      return json({ error: 'Not found' }, { status: 404 });
    }

    // ── Seed tokens (admin-protected, Basic auth) ─────────────────────────
    // POST /auth/tokens/:piece  { userId, accessToken, refreshToken?, expiresIn? }
    if (pathname.startsWith('/auth/tokens/') && request.method === 'POST') {
      // Require Basic auth — same user/pass as admin panel.
      if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) {
        return json({ error: 'Admin credentials not configured' }, { status: 503 });
      }
      const authHeader = request.headers.get('authorization') ?? '';
      let authed = false;
      if (authHeader.startsWith('Basic ')) {
        const decoded = atob(authHeader.slice(6));
        const colonIdx = decoded.indexOf(':');
        if (colonIdx > 0) {
          const user = decoded.slice(0, colonIdx);
          const pass = decoded.slice(colonIdx + 1);
          authed = timingSafeEqual(user, env.ADMIN_USER) && timingSafeEqual(pass, env.ADMIN_PASSWORD);
        }
      }
      if (!authed) return json({ error: 'Unauthorized' }, { status: 401 });

      const pieceName = pathname.slice('/auth/tokens/'.length);
      if (!getPiece(pieceName)) return json({ error: 'Piece not found' }, { status: 404 });

      let body: { userId?: string; accessToken?: string; refreshToken?: string; expiresIn?: number };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const { userId, accessToken, refreshToken, expiresIn } = body;
      if (!userId || !accessToken) {
        return json({ error: 'Missing required fields: userId, accessToken' }, { status: 400 });
      }

      const record: import('./framework/types').OAuthTokenRecord = {
        accessToken,
        refreshToken,
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
        tokenType: 'Bearer',
      };
      await storeToken(env.TOKEN_STORE, pieceName, userId, record, env.TOKEN_ENCRYPTION_KEY);
      return json({ ok: true, piece: pieceName, userId });
    }

    // ── Inbound webhook (Slack Events API and equivalents) ──────────────────
    const webhookMatch = /^\/webhook\/([^/]+)$/.exec(pathname);
    if (webhookMatch && request.method === 'POST') {
      const pieceName = decodeURIComponent(webhookMatch[1]);
      const stored = getPiece(pieceName);
      if (!stored || stored.kind !== 'ap') {
        return json({ error: 'Piece not found or not an AP piece' }, { status: 404 });
      }
      const { piece } = stored;

      // Read raw body text before parsing (needed for HMAC verification)
      const rawBody = await request.text();

      // Verify Slack signature when the signing secret is configured
      const envRecord = env as Record<string, string>;
      const signingSecretKey = `${pieceName.toUpperCase().replace(/-/g, '_')}_SIGNING_SECRET`;
      const signingSecret = envRecord[signingSecretKey] as string | undefined;
      if (signingSecret) {
        const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
        const signature = request.headers.get('x-slack-signature') ?? '';
        const valid = await verifySlackSignature(signingSecret, rawBody, timestamp, signature);
        if (!valid) {
          return json({ error: 'Invalid signature' }, { status: 401 });
        }
      }

      let webhookBody: Record<string, unknown>;
      try {
        webhookBody = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      // Slack URL verification — must reply synchronously with the challenge value
      if (webhookBody['type'] === 'url_verification') {
        return json({ challenge: webhookBody['challenge'] });
      }

      // Fan out asynchronously so we can return 200 within Slack's 3-second window
      ctx.waitUntil(
        dispatchWebhook(pieceName, piece, webhookBody, env).catch((err: unknown) =>
          console.error('[freepieces] dispatchWebhook error:', err),
        ),
      );
      return new Response('OK', { status: 200 });
    }

    // ── Webhook subscriptions ─────────────────────────────────────────────────

    // POST /subscriptions/:piece/:trigger
    //   Body: { callbackUrl | queueName, propsValue? }
    const subCreateMatch = /^\/subscriptions\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (subCreateMatch && request.method === 'POST') {
      const pieceName = decodeURIComponent(subCreateMatch[1]);
      const triggerName = decodeURIComponent(subCreateMatch[2]);

      const stored = getPiece(pieceName);
      if (!stored || stored.kind !== 'ap') {
        return json({ error: 'Piece not found or not an AP piece' }, { status: 404 });
      }
      if (!getTrigger(pieceName, triggerName)) {
        return json({ error: 'Trigger not found' }, { status: 404 });
      }

      const authResult = resolveRuntimeRequestAuth(request.headers, env.RUN_API_KEY);
      if (!authResult.ok) {
        return json({ error: authResult.error }, { status: authResult.status });
      }
      const { userId, pieceToken, pieceAuthProps } = authResult.credentials;

      let subBody: { callbackUrl?: string; queueName?: string; propsValue?: Record<string, unknown> };
      try {
        subBody = (await request.json()) as typeof subBody;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const { callbackUrl, queueName, propsValue = {} } = subBody;

      // Exactly one delivery target required
      if (callbackUrl && queueName) {
        return json({ error: 'Provide either callbackUrl or queueName, not both' }, { status: 400 });
      }
      if (!callbackUrl && !queueName) {
        return json({ error: 'Missing required field: callbackUrl or queueName' }, { status: 400 });
      }

      // Validate callbackUrl (HTTPS only to mitigate SSRF)
      if (callbackUrl) {
        try {
          const parsed = new URL(callbackUrl);
          if (parsed.protocol !== 'https:') throw new Error();
        } catch {
          return json({ error: 'callbackUrl must be a valid HTTPS URL' }, { status: 400 });
        }
      }

      // Validate queueName binding exists in env
      if (queueName) {
        if (!resolveQueueBinding(env, queueName)) {
          return json({ error: `Queue binding not found for "${queueName}". Add a [[queues.producers]] entry to wrangler.toml.` }, { status: 400 });
        }
      }

      const subId = crypto.randomUUID();
      const sub: WebhookSubscription = {
        id: subId,
        trigger: triggerName,
        propsValue,
        ...(callbackUrl ? { callbackUrl } : { queueName }),
        userId,
        pieceToken,
        ...(pieceAuthProps ? { pieceAuthProps } : {}),
        createdAt: new Date().toISOString(),
      };
      await env.TOKEN_STORE.put(SUB_KEY(pieceName, subId), JSON.stringify(sub));

      const webhookUrl = `${env.FREEPIECES_PUBLIC_URL}/webhook/${pieceName}`;
      return json({ ok: true, id: subId, webhookUrl }, { status: 201 });
    }

    // GET /subscriptions/:piece  (returns only caller's subscriptions)
    const subListMatch = /^\/subscriptions\/([^/]+)$/.exec(pathname);
    if (subListMatch && request.method === 'GET') {
      const pieceName = decodeURIComponent(subListMatch[1]);

      const authResult = resolveRuntimeRequestAuth(request.headers, env.RUN_API_KEY);
      if (!authResult.ok) {
        return json({ error: authResult.error }, { status: authResult.status });
      }

      const allSubs = await listSubscriptions(env.TOKEN_STORE, pieceName);
      const mine = allSubs
        .filter((s) => sameSubscriptionOwner(s, authResult.credentials))
        .map((s) => ({
          id: s.id,
          trigger: s.trigger,
          propsValue: s.propsValue,
          ...(s.callbackUrl ? { callbackUrl: s.callbackUrl } : {}),
          ...(s.queueName ? { queueName: s.queueName } : {}),
          createdAt: s.createdAt,
        }));
      return json({ ok: true, subscriptions: mine });
    }

    // DELETE /subscriptions/:piece/:trigger/:id  (must match creation identity)
    const subDeleteMatch = /^\/subscriptions\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (subDeleteMatch && request.method === 'DELETE') {
      const pieceName = decodeURIComponent(subDeleteMatch[1]);
      const subDelId = decodeURIComponent(subDeleteMatch[3]);

      const authResult = resolveRuntimeRequestAuth(request.headers, env.RUN_API_KEY);
      if (!authResult.ok) {
        return json({ error: authResult.error }, { status: authResult.status });
      }

      const rawSub = await env.TOKEN_STORE.get(SUB_KEY(pieceName, subDelId));
      if (!rawSub) return json({ error: 'Subscription not found' }, { status: 404 });

      const existingSub = JSON.parse(rawSub) as WebhookSubscription;
      if (!sameSubscriptionOwner(existingSub, authResult.credentials)) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      await env.TOKEN_STORE.delete(SUB_KEY(pieceName, subDelId));
      return json({ ok: true, id: subDelId });
    }

    return json({ error: 'Not found' }, { status: 404 });
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await Promise.allSettled(
      batch.messages.map(async (msg) => {
        const body = msg.body as { pieceName?: string; payload?: unknown };
        const { pieceName, payload } = body;
        if (!pieceName) {
          msg.ack();
          return;
        }
        const stored = getPiece(pieceName);
        if (!stored || stored.kind !== 'ap') {
          msg.ack();
          return;
        }
        await dispatchWebhook(pieceName, stored.piece, payload, env);
        msg.ack();
      }),
    );
  },
} satisfies ExportedHandler<Env>;
