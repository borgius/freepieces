/**
 * MCP route handlers.
 *
 * Exposes each registered piece as a sessionless JSON-RPC MCP server at
 * /mcp/:piece. Each action on the piece is advertised as an MCP tool and
 * executed with the same runtime auth credentials used by /run.
 */

import { Hono } from 'hono';
import { timeout } from 'hono/timeout';
import { getPiece } from '../framework/registry';
import { buildApContext } from '../lib/ap-context';
import { resolveApRuntimeAuth, resolveNativeRuntimeAuth, forceRefreshNativeAuth } from '../lib/auth-resolve';
import { runtimeAuth } from '../lib/runtime-auth-middleware';
import type { ApPiece, Env, PieceDefinition, PropDefinition } from '../framework/types';
import type { RuntimeRequestCredentials } from '../lib/request-auth';
import { getKVBinding } from '../lib/env';
import { isActionEnabledInState, loadUserToolState } from '../lib/user-tool-state';

const MCP_PROTOCOL_VERSION = '2024-11-05';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolCallParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

const mcpApi = new Hono<{
  Bindings: Env;
  Variables: { credentials: RuntimeRequestCredentials };
}>();

mcpApi.use('/mcp/*', runtimeAuth);
mcpApi.use('/mcp/*', timeout(30_000));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function propToJsonSchema(prop: PropDefinition): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    title: prop.displayName,
    description: prop.description,
  };

  switch (prop.type) {
    case 'NUMBER':
      schema['type'] = 'number';
      break;
    case 'CHECKBOX':
      schema['type'] = 'boolean';
      break;
    case 'ARRAY':
      schema['type'] = 'array';
      schema['items'] = {};
      break;
    case 'OBJECT':
    case 'JSON':
      schema['type'] = 'object';
      break;
    default:
      schema['type'] = 'string';
      break;
  }

  if (prop.defaultValue !== undefined) {
    schema['default'] = prop.defaultValue;
  }

  return schema;
}

function propsToInputSchema(props: Record<string, PropDefinition> | undefined): McpTool['inputSchema'] {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, prop] of Object.entries(props ?? {})) {
    properties[name] = propToJsonSchema(prop);
    if (prop.required) required.push(name);
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function nativeTools(piece: PieceDefinition, enabledActions?: Set<string>): McpTool[] {
  return piece.actions
    .filter((action) => !enabledActions || enabledActions.has(action.name))
    .map((action) => ({
      name: action.name,
      title: action.displayName,
      description: action.description ?? `${action.displayName}.`,
      inputSchema: propsToInputSchema(action.props),
    }));
}

function apTools(piece: ApPiece, enabledActions?: Set<string>): McpTool[] {
  return Object.values(piece._actions)
    .filter((action) => !enabledActions || enabledActions.has(action.name))
    .map((action) => ({
      name: action.name,
      title: action.displayName,
      description: action.description ?? `${action.displayName}.`,
      inputSchema: propsToInputSchema(extractApProps(action.props)),
    }));
}

function hasAction(stored: NonNullable<ReturnType<typeof getPiece>>, actionName: string): boolean {
  if (stored.kind === 'native') {
    return stored.def.actions.some((action) => action.name === actionName);
  }

  return Boolean(stored.piece._actions[actionName]);
}

async function enabledActionNames(
  pieceName: string,
  credentials: RuntimeRequestCredentials,
  env: Env,
): Promise<Set<string> | undefined> {
  const toolOwner = credentials.toolOwnerId ?? credentials.userId;
  if (!toolOwner) {
    return undefined;
  }

  const stored = getPiece(pieceName);
  if (!stored) {
    return undefined;
  }

  const tokenStore = getKVBinding(env, 'TOKEN_STORE');
  if (!tokenStore) {
    return undefined;
  }

  const toolState = await loadUserToolState(tokenStore, toolOwner, pieceName);
  const actionNames = stored.kind === 'native'
    ? stored.def.actions.map((action) => action.name)
    : Object.values(stored.piece._actions).map((action) => action.name);

  return new Set(actionNames.filter((actionName) => isActionEnabledInState(toolState, actionName)));
}

function extractApProps(raw: Record<string, unknown> | undefined): Record<string, PropDefinition> | undefined {
  if (!raw) return undefined;

  const props: Record<string, PropDefinition> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    props[name] = {
      type: String(value['type'] ?? 'UNKNOWN'),
      displayName: String(value['displayName'] ?? name),
      description: value['description'] != null ? String(value['description']) : undefined,
      required: Boolean(value['required']),
      defaultValue: value['defaultValue'],
    };
  }

  return Object.keys(props).length > 0 ? props : undefined;
}

function success(id: JsonRpcId | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result });
}

function failure(id: JsonRpcId | undefined, code: number, message: string): Response {
  return Response.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  });
}

function textContent(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

async function runTool(
  pieceName: string,
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  credentials: RuntimeRequestCredentials,
): Promise<unknown> {
  const stored = getPiece(pieceName);
  if (!stored) throw new Error('Piece not found');

  const { userId, pieceToken, pieceAuthProps } = credentials;

  if (stored.kind === 'native') {
    const action = stored.def.actions.find((entry) => entry.name === toolName);
    if (!action) throw new Error('Tool not found');

    let auth = await resolveNativeRuntimeAuth(pieceName, stored.def.auth, env, userId, pieceToken);
    if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };

    return action.run({
      auth,
      props: args,
      env,
      refreshAuth: async () => {
        const refreshed = await forceRefreshNativeAuth(pieceName, stored.def.auth, env, userId);
        if (!refreshed) return undefined;
        return pieceAuthProps ? { ...refreshed, ...pieceAuthProps } : refreshed;
      },
    });
  }

  const action = stored.piece._actions[toolName];
  if (!action) throw new Error('Tool not found');

  let auth = await resolveApRuntimeAuth(pieceName, stored.piece, env, userId, pieceToken);
  if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };

  return action.run(buildApContext(pieceName, stored.piece, auth, args, env));
}

async function handleRpc(pieceName: string, env: Env, credentials: RuntimeRequestCredentials, request: JsonRpcRequest): Promise<Response> {
  const stored = getPiece(pieceName);
  if (!stored) return failure(request.id, -32602, 'Piece not found');

  const actionsForUser = await enabledActionNames(pieceName, credentials, env);

  switch (request.method) {
    case 'initialize':
      return success(request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: `freepieces-${pieceName}`,
          version: stored.kind === 'native' ? stored.def.version : '0.1.0',
        },
      });

    case 'ping':
      return success(request.id, {});

    case 'tools/list':
      return success(request.id, {
        tools: stored.kind === 'native' ? nativeTools(stored.def, actionsForUser) : apTools(stored.piece, actionsForUser),
      });

    case 'tools/call': {
      const params = isRecord(request.params) ? request.params as ToolCallParams : {};
      if (!params.name) return failure(request.id, -32602, 'Missing tool name');
      if (!hasAction(stored, params.name) || (actionsForUser && !actionsForUser.has(params.name))) {
        return failure(request.id, -32602, `Unknown tool: ${params.name}`);
      }

      const result = await runTool(
        pieceName,
        params.name,
        isRecord(params.arguments) ? params.arguments : {},
        env,
        credentials,
      );

      return success(request.id, {
        content: [{ type: 'text', text: textContent(result) }],
        structuredContent: result,
      });
    }

    default:
      return failure(request.id, -32601, 'Method not found');
  }
}

mcpApi.get('/mcp/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);

  const actionsForUser = await enabledActionNames(pieceName, c.var.credentials, c.env);

  return c.json({
    name: pieceName,
    endpoint: `/mcp/${pieceName}`,
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: stored.kind === 'native' ? nativeTools(stored.def, actionsForUser) : apTools(stored.piece, actionsForUser),
  });
});

mcpApi.post('/mcp/:piece', async (c) => {
  const pieceName = c.req.param('piece');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(null, -32700, 'Parse error');
  }

  if (!isRecord(body)) {
    return failure(null, -32600, 'Invalid request');
  }

  try {
    return await handleRpc(pieceName, c.env, c.var.credentials, body);
  } catch (err) {
    console.error(`[freepieces] MCP ${pieceName} failed:`, err);
    return failure(body.id as JsonRpcId | undefined, -32603, err instanceof Error ? err.message : 'Internal error');
  }
});

export default mcpApi;
