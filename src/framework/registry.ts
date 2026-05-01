import type { PieceDefinition, PropDefinition, ApPiece, ApTrigger, PieceTrigger } from './types';

// ---------------------------------------------------------------------------
// Internal storage — discriminated union so the worker can do the right thing
// ---------------------------------------------------------------------------

type StoredPiece =
  | { kind: 'native'; def: PieceDefinition }
  | { kind: 'ap'; name: string; piece: ApPiece };

const pieces = new Map<string, StoredPiece>();

// ---------------------------------------------------------------------------
// Derived-data caches.
//
// These are rebuilt lazily on first read after any `registerPiece` /
// `registerApPiece` call, so callers on the hot path (admin `/pieces`,
// runtime action/trigger dispatch, webhook fan-out) pay no per-request cost
// for list construction, secret derivation, or trigger lookups.
// ---------------------------------------------------------------------------

// Bumped on every register*() call. Every cache is invalidated when it notices
// a mismatch against the snapshot taken when it was last populated.
let registryVersion = 0;

let listPiecesCache: PieceSummaryEntry[] | null = null;
let listPiecesVersion = -1;

const secretsCache = new Map<string, SecretGroup[]>();

// Fast O(1) trigger lookup: pieceName -> triggerName -> def
const triggerIndex = new Map<string, Map<string, ApTrigger | PieceTrigger>>();
let triggerIndexVersion = -1;

function invalidateRegistryCaches(): void {
  registryVersion++;
}

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
  invalidateRegistryCaches();
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
  invalidateRegistryCaches();
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Return the raw stored entry.  Callers discriminate on `.kind`. */
export function getPiece(name: string): StoredPiece | undefined {
  return pieces.get(name);
}

// ---------------------------------------------------------------------------
// Secret derivation
// ---------------------------------------------------------------------------

export interface SecretDef {
  /** Cloudflare secret / env key, e.g. "SLACK_BOT_TOKEN" */
  key: string;
  /** Human-readable label, e.g. "Bot Token" */
  displayName: string;
  /** Human-readable hint about what this token is / where to find it */
  description?: string;
  /** Whether the secret is mandatory within this auth mode */
  required: boolean;
  /** Ready-to-paste CLI command */
  command: string;
}

/**
 * A single auth mode with its required secrets.
 * When a piece has multiple groups, the user picks ONE group to set up.
 */
export interface SecretGroup {
  /** AP auth type: 'OAUTH2', 'CUSTOM_AUTH', 'SECRET_TEXT', 'BASIC_AUTH', 'oauth2', 'apiKey' */
  authType: string;
  /** Human-readable mode label, e.g. "Bot Token", "OAuth2" */
  displayName: string;
  secrets: SecretDef[];
}

/** camelCase → SCREAMING_SNAKE_CASE (mirrors worker.ts envKey derivation) */
function toScreamingSnake(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toUpperCase();
}

function makeSecret(key: string, displayName: string, required: boolean, description?: string): SecretDef {
  return { key, displayName, description, required, command: `wrangler secret put ${key}` };
}

function requireNativeOAuthEnvKey(
  auth: Record<string, unknown>,
  key: 'clientIdEnvKey' | 'clientSecretEnvKey',
  pieceName: string,
): string {
  const value = auth[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Native OAuth2 piece "${pieceName}" must define ${key}`);
  }
  return value;
}

/**
 * Derive auth mode groups for a piece, each containing the secrets needed for that mode.
 * Pieces with multiple auth modes (e.g. Slack: OAUTH2 + CUSTOM_AUTH) return one group per mode
 * so the user can pick the mode they want to set up — not a combined flat list.
 */
function deriveSecretsUncached(stored: StoredPiece): SecretGroup[] {
  if (stored.kind === 'native') {
    const auth = stored.def.auth as unknown as Record<string, unknown>;
    if (auth['type'] === 'oauth2') {
      const clientIdEnvKey = requireNativeOAuthEnvKey(auth, 'clientIdEnvKey', stored.def.name);
      const clientSecretEnvKey = requireNativeOAuthEnvKey(auth, 'clientSecretEnvKey', stored.def.name);
      return [{
        authType: 'oauth2',
        displayName: 'OAuth2',
        secrets: [
          makeSecret(clientIdEnvKey, 'OAuth Client ID', true),
          makeSecret(clientSecretEnvKey, 'OAuth Client Secret', true),
          makeSecret('TOKEN_ENCRYPTION_KEY', 'Token Encryption Key (openssl rand -hex 32)', true),
        ],
      }];
    }
    // apiKey and none: secrets supplied per-request, nothing to pre-configure
    return [];
  }

  const prefix = stored.name.toUpperCase();
  const rawAuth = stored.piece.auth;
  const authArr = Array.isArray(rawAuth)
    ? (rawAuth as unknown as Array<Record<string, unknown>>)
    : [(rawAuth as unknown) as Record<string, unknown>];

  const groups: SecretGroup[] = [];

  for (const authDef of authArr) {
    const type = String(authDef['type'] ?? '');
    const label = String(authDef['displayName'] ?? type);

    if (type === 'OAUTH2') {
      groups.push({
        authType: 'OAUTH2',
        displayName: label || 'OAuth2',
        secrets: [
          makeSecret(`${prefix}_CLIENT_ID`, 'OAuth Client ID', true),
          makeSecret(`${prefix}_CLIENT_SECRET`, 'OAuth Client Secret', true),
          makeSecret('TOKEN_ENCRYPTION_KEY', 'Token Encryption Key (openssl rand -hex 32)', true),
        ],
      });
    } else if (type === 'CUSTOM_AUTH') {
      const props = (authDef['props'] ?? {}) as Record<string, Record<string, unknown>>;
      const secrets = Object.entries(props).map(([key, prop]) =>
        makeSecret(
          `${prefix}_${toScreamingSnake(key)}`,
          String(prop['displayName'] ?? key),
          Boolean(prop['required']),
          prop['description'] != null ? String(prop['description']) : undefined,
        )
      );
      if (secrets.length > 0) {
        groups.push({ authType: 'CUSTOM_AUTH', displayName: label || 'Custom Auth', secrets });
      }
    } else if (type === 'SECRET_TEXT') {
      groups.push({
        authType: 'SECRET_TEXT',
        displayName: label || 'Secret Key',
        secrets: [
          makeSecret(`${prefix}_TOKEN`, 'Secret Token', true),
          makeSecret('TOKEN_ENCRYPTION_KEY', 'Token Encryption Key (openssl rand -hex 32)', true),
        ],
      });
    } else if (type === 'BASIC_AUTH') {
      groups.push({
        authType: 'BASIC_AUTH',
        displayName: label || 'Basic Auth',
        secrets: [
          makeSecret(`${prefix}_USERNAME`, 'Username', true),
          makeSecret(`${prefix}_PASSWORD`, 'Password', true),
        ],
      });
    }
  }

  return groups;
}

/** Shape returned by `listPieces()`. */
export interface PieceSummaryEntry {
  name: string;
  displayName: string;
  description: string | undefined;
  version: string;
  auth: PieceDefinition['auth'] | ApPiece['auth'];
  actions: Array<{ name: string; displayName: string; description?: string; props?: Record<string, PropDefinition> }>;
  triggers: Array<{ name: string; displayName: string; description?: string; type: string; props?: Record<string, PropDefinition> }>;
  secrets: SecretGroup[];
  mcpEndpoint: string;
}

/** Derive secrets for a piece, memoized per registry version. */
function deriveSecrets(stored: StoredPiece): SecretGroup[] {
  const key = stored.kind === 'native' ? `n:${stored.def.name}` : `a:${stored.name}`;
  const cached = secretsCache.get(key);
  if (cached) return cached;
  const groups = deriveSecretsUncached(stored);
  secretsCache.set(key, groups);
  return groups;
}

/** Normalised piece list for the /pieces API. Memoized per registry version. */
export function listPieces(): PieceSummaryEntry[] {
  if (listPiecesCache && listPiecesVersion === registryVersion) return listPiecesCache;

  // Registry mutated — drop stale per-piece caches.
  secretsCache.clear();

  const result = [...pieces.values()].map((stored): PieceSummaryEntry => {
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
        triggers: (d.triggers ?? []).map((t) => ({
          name: t.name,
          displayName: t.displayName,
          description: t.description,
          type: t.type,
          props: t.props,
        })),
        secrets: deriveSecrets(stored),
        mcpEndpoint: `/mcp/${d.name}`,
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
      secrets: deriveSecrets(stored),
      mcpEndpoint: `/mcp/${name}`,
    };
  });

  listPiecesCache = result;
  listPiecesVersion = registryVersion;
  return result;
}

/**
 * Rebuild the trigger lookup index so `getTrigger()` is O(1).
 * Called lazily from `getTrigger()` when the registry has changed.
 */
function rebuildTriggerIndex(): void {
  triggerIndex.clear();
  for (const stored of pieces.values()) {
    const name = stored.kind === 'native' ? stored.def.name : stored.name;
    const inner = new Map<string, ApTrigger | PieceTrigger>();
    if (stored.kind === 'ap') {
      for (const [trigName, trig] of Object.entries(stored.piece._triggers ?? {})) {
        inner.set(trigName, trig as ApTrigger);
      }
    } else {
      for (const trig of stored.def.triggers ?? []) {
        inner.set(trig.name, trig);
      }
    }
    triggerIndex.set(name, inner);
  }
  triggerIndexVersion = registryVersion;
}

/**
 * Look up a single trigger by piece name + trigger name.
 * Works for both AP and native pieces. O(1) after first call per registry version.
 */
export function getTrigger(pieceName: string, triggerName: string): ApTrigger | PieceTrigger | undefined {
  if (triggerIndexVersion !== registryVersion) rebuildTriggerIndex();
  return triggerIndex.get(pieceName)?.get(triggerName);
}

/** Reset all registry state. Exported for tests. */
export function __resetRegistryForTests(): void {
  pieces.clear();
  secretsCache.clear();
  triggerIndex.clear();
  listPiecesCache = null;
  listPiecesVersion = -1;
  triggerIndexVersion = -1;
  invalidateRegistryCaches();
}
