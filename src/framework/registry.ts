import type { PieceDefinition, PropDefinition, ApPiece, ApTrigger, PieceTrigger } from './types';

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
function deriveSecrets(stored: StoredPiece): SecretGroup[] {
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

/** Normalised piece list for the /pieces API. */
export function listPieces(): Array<{
  name: string;
  displayName: string;
  description: string | undefined;
  version: string;
  auth: PieceDefinition['auth'] | ApPiece['auth'];
  actions: Array<{ name: string; displayName: string; description?: string; props?: Record<string, PropDefinition> }>;
  triggers: Array<{ name: string; displayName: string; description?: string; type: string; props?: Record<string, PropDefinition> }>;
  secrets: SecretGroup[];
  mcpEndpoint: string;
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
}

/**
 * Look up a single trigger by piece name + trigger name.
 * Works for both AP and native pieces.
 */
export function getTrigger(pieceName: string, triggerName: string): ApTrigger | PieceTrigger | undefined {
  const stored = pieces.get(pieceName);
  if (!stored) return undefined;
  if (stored.kind === 'ap') return stored.piece._triggers?.[triggerName];
  return stored.def.triggers?.find((t) => t.name === triggerName);
}
