/**
 * Slack — native @activepieces/piece-slack integration.
 *
 * Auth secrets (CUSTOM_AUTH / Bot Token mode):
 *   wrangler secret put SLACK_BOT_TOKEN    # xoxb-...  (required)
 *   wrangler secret put SLACK_USER_TOKEN   # xoxp-...  (optional)
 *
 * Or pass  Authorization: Bearer <xoxb-...>  at request time.
 *
 * Registered as:  registerApPiece('slack', slackPiece)  in worker.ts
 */
import pkg from '@activepieces/piece-slack';
import type { ApPiece } from '../framework/types';

export const slackPiece = (pkg as unknown as { slack: ApPiece }).slack;

