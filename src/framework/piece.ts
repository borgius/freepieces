import type { PieceDefinition, PieceTrigger } from './types';

/**
 * Define a piece.  This is the primary builder function for the freepieces
 * native piece model — a lightweight, zero-dependency replacement for
 * `@activepieces/pieces-framework`.
 */
export function createPiece(definition: PieceDefinition): PieceDefinition {
  return definition;
}

/**
 * Define a trigger.  Use this to author native triggers with any strategy
 * (`POLLING`, `WEBHOOK`, or `APP_WEBHOOK`) using the same mental model as
 * the Activepieces `createTrigger` builder.
 */
export function createTrigger(definition: PieceTrigger): PieceTrigger {
  return definition;
}
