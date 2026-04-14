/**
 * Slack piece — powered by @activepieces/piece-slack
 *
 * Auth
 * ────
 *   Bot Token (xoxb-*) stored as a Cloudflare Secret:
 *     wrangler secret put SLACK_BOT_TOKEN
 *
 *   Optionally a Slack user token (xoxp-*) for user-scoped actions:
 *     wrangler secret put SLACK_USER_TOKEN
 *
 *   The bot token can also be provided at request-time via:
 *     Authorization: Bearer xoxb-...
 *
 * All 26 Slack actions from @activepieces/piece-slack are exposed directly.
 * No re-implementation — this is a thin context-bridge adapter.
 */

// @activepieces/piece-slack is CJS; esbuild resolves this default import at bundle time.
import slackPkg from '@activepieces/piece-slack';

const { slack } = (slackPkg as unknown) as {
  slack: {
    displayName: string;
    description: string;
    _actions: Record<string, {
      name: string;
      displayName: string;
      description?: string;
      run(context: unknown): Promise<unknown>;
    }>;
  };
};

import { createPiece } from '../framework/piece';
import type { PieceActionContext, PieceAction } from '../framework/types';

// ---------------------------------------------------------------------------
// Context bridge: freepieces PieceActionContext → Activepieces context shape
// ---------------------------------------------------------------------------
function makeApContext(ctx: PieceActionContext): unknown {
  // Bot token: prefer request-time auth header, fall back to env secret
  const botToken =
    ctx.auth?.token ?? (ctx.env as Record<string, string>)['SLACK_BOT_TOKEN'] ?? '';
  const userToken =
    (ctx.env as Record<string, string>)['SLACK_USER_TOKEN'] ?? '';

  return {
    auth: { botToken, userToken },
    propsValue: (ctx.props ?? {}) as Record<string, unknown>,
    // Minimal store stub — Slack actions don't persist state between calls
    store: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    files: { write: async () => ({}) },
    serverUrl: ctx.env.FREEPIECES_PUBLIC_URL ?? '',
    generateResumeUrl: () => '',
    run: { pause: () => undefined, stop: () => undefined },
    connections: {},
    variables: {},
    tags: [],
  };
}

// ---------------------------------------------------------------------------
// Adapt all Activepieces Slack actions into freepieces PieceActions
// ---------------------------------------------------------------------------
function adaptActions(): PieceAction[] {
  return Object.values(slack._actions).map((action) => ({
    name: action.name,
    displayName: action.displayName,
    description: action.description,
    async run(ctx: PieceActionContext): Promise<unknown> {
      return action.run(makeApContext(ctx));
    },
  }));
}

// ---------------------------------------------------------------------------
// Piece definition
// ---------------------------------------------------------------------------
export const slackPiece = createPiece({
  name: 'slack',
  displayName: slack.displayName,
  description: slack.description,
  version: '0.1.0',
  /**
   * apiKey auth: the bot token is passed via Authorization: Bearer <xoxb-...>
   * by script clients, or read from the SLACK_BOT_TOKEN env secret automatically.
   */
  auth: { type: 'apiKey', headerName: 'Authorization' },
  actions: adaptActions(),
});

