/**
 * Piece registry for the consumer worker example.
 *
 * Add your own pieces here — either native freepieces pieces via
 * registerPiece(), or Activepieces community pieces via registerApPiece().
 *
 * To install an AP piece run:
 *   fp install @activepieces/piece-airtable
 * inside this directory (mirrors the freepieces-repo workflow).
 */

import { registerApPiece } from 'freepieces/framework';
import type { ApPiece } from 'freepieces/framework';

// ── Example: register an AP community piece ─────────────────────────────
// Uncomment and run `pnpm add @activepieces/piece-airtable` to activate.
//
// import airtablePkg from '@activepieces/piece-airtable';
// registerApPiece('airtable', (airtablePkg as unknown as { airtable: ApPiece }).airtable);

// Suppress unused-import warning — remove when at least one piece is added.
void registerApPiece;
void (null as unknown as ApPiece);
