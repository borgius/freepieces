export { createFreepiecesWorker } from './create-worker.js';
export type { FreepiecesWorker } from './create-worker.js';
export { gmailPiece } from '../pieces/gmail.js';
// Re-export the framework public surface so consumers can import everything
// they need from one subpath and share the same global registry instance.
export { createPiece } from '../framework/piece.js';
export { registerPiece, registerApPiece, getPiece, listPieces } from '../framework/registry.js';
export type {
  Env,
  PieceDefinition,
  PropDefinition,
  ApPiece,
  ApTrigger,
  PieceTrigger,
} from '../framework/types.js';
