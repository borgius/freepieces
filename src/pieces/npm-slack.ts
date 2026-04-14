/**
 * Slack — native @activepieces/piece-slack integration.
 *
 * Auth secrets (CUSTOM_AUTH / Bot Token mode):
 *   wrangler secret put SLACK_BOT_TOKEN    # xoxb-...  (required)
 *   wrangler secret put SLACK_USER_TOKEN   # xoxp-...  (optional)
 *
 * Or pass  Authorization: Bearer <xoxb-...>  at request time.
 */
import pkg from '@activepieces/piece-slack';
import { registerApPiece } from '../framework/registry.js';
import type { ApPiece } from '../framework/types.js';

const slackPiece = (pkg as unknown as { slack: ApPiece }).slack;
registerApPiece('slack', slackPiece);

