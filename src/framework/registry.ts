import type { PieceDefinition } from './types';

const pieces = new Map<string, PieceDefinition>();

/** Register a piece so it is available to the router and script client. */
export function registerPiece(piece: PieceDefinition): void {
  pieces.set(piece.name, piece);
}

/** Look up a piece by its canonical name. */
export function getPiece(name: string): PieceDefinition | undefined {
  return pieces.get(name);
}

/** Return all registered pieces. */
export function listPieces(): PieceDefinition[] {
  return [...pieces.values()];
}
