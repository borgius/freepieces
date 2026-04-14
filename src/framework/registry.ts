import type { PieceDefinition, PropDefinition, ApPiece, ApTrigger } from './types';

// ---------------------------------------------------------------------------
// Internal storage — discriminated union so the worker can do the right thing
// ---------------------------------------------------------------------------

type StoredPiece =
  | { kind: 'native'; def: PieceDefinition }
  | { kind: 'ap'; name: string; piece: ApPiece };

const pieces = new Map<string, StoredPiece>();

// ---------------------------------------------------------------------------
// Prop extraction helper
// ---------------------------------------------------------------------------

/**
 * Normalise an AP Property descriptor (or freepieces PropDefinition) into a
 * plain PropDefinition.  AP props are objects whose `type` is a PropertyType
 * enum value — at runtime that's just a string.
 */
function extractProps(
  raw: Record<string, unknown> | undefined
): Record<string, PropDefinition> | undefined {
  if (!raw) return undefined;
  const out: Record<string, PropDefinition> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    out[key] = {
      type: String(v['type'] ?? 'UNKNOWN'),
      displayName: String(v['displayName'] ?? key),
      description: v['description'] != null ? String(v['description']) : undefined,
      required: Boolean(v['required']),
      defaultValue: v['defaultValue'],
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register a freepieces native piece. */
export function registerPiece(piece: PieceDefinition): void {
  pieces.set(piece.name, { kind: 'native', def: piece });
}

/**
 * Register an Activepieces community piece (from @activepieces/piece-*) with
 * zero adapter code.  The name you provide here becomes the URL segment used
 * in /pieces, /run/:name/:action, etc.
 *
 * @example
 *   import pkg from '@activepieces/piece-slack';
 *   import type { ApPiece } from './framework/types';
 *   registerApPiece('slack', (pkg as unknown as { slack: ApPiece }).slack);
 */
export function registerApPiece(name: string, piece: ApPiece): void {
  pieces.set(name, { kind: 'ap', name, piece });
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Return the raw stored entry.  Callers discriminate on `.kind`. */
export function getPiece(name: string): StoredPiece | undefined {
  return pieces.get(name);
}

/** Normalised piece list for the /pieces API. */
export function listPieces(): Array<{
  name: string;
  displayName: string;
  description: string | undefined;
  version: string;
  auth: PieceDefinition['auth'] | ApPiece['auth'];
  actions: Array<{ name: string; displayName: string; description?: string; props?: Record<string, PropDefinition> }>;
  triggers: Array<{ name: string; displayName: string; description?: string; type: string; props?: Record<string, PropDefinition> }>;
}> {
  return [...pieces.values()].map((stored) => {
    if (stored.kind === 'native') {
      const d = stored.def;
      return {
        name: d.name,
        displayName: d.displayName,
        description: d.description,
        version: d.version,
        auth: d.auth,
        actions: d.actions.map((a) => ({
          name: a.name,
          displayName: a.displayName,
          description: a.description,
          props: a.props,
        })),
        triggers: [],
      };
    }
    // AP piece
    const { name, piece } = stored;
    return {
      name,
      displayName: piece.displayName,
      description: piece.description,
      version: '0.1.0',
      auth: piece.auth,
      actions: Object.values(piece._actions).map((a) => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        props: extractProps(a.props),
      })),
      triggers: Object.values(piece._triggers ?? {}).map((t) => ({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        type: t.type,
        props: extractProps(t.props),
      })),
    };
  });
}

/**
 * Look up a single AP trigger by piece name + trigger name.
 * Returns undefined for native pieces (they have no AP triggers).
 */
export function getTrigger(pieceName: string, triggerName: string): ApTrigger | undefined {
  const stored = pieces.get(pieceName);
  if (!stored || stored.kind !== 'ap') return undefined;
  return stored.piece._triggers?.[triggerName];
}
