import type { PieceDefinition } from './types';

/**
 * Define a piece.  This is the primary builder function for the freepieces
 * native piece model — a lightweight, zero-dependency replacement for
 * `@activepieces/pieces-framework`.
 */
export function createPiece(definition: PieceDefinition): PieceDefinition {
  return definition;
}
