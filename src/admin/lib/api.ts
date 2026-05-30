/**
 * Admin API client.
 *
 * All requests use credentials: 'include' so the session cookie is sent
 * automatically. The worker validates the cookie on every /admin/api/* call.
 */

export interface PropDef {
  type: string;
  displayName: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
}

export interface SecretDef {
  key: string;
  displayName: string;
  description?: string;
  required: boolean;
  command: string;
  /** Whether the secret is currently set in the worker environment. Populated server-side. */
  isSet?: boolean;
}

export interface SecretGroup {
  authType: string;
  displayName: string;
  secrets: SecretDef[];
}

export interface PieceAuthMode {
  type: string;
}

export type PieceAuth = PieceAuthMode | PieceAuthMode[] | undefined;

export interface GlobalSecretDef {
  key: string;
  displayName: string;
  description: string;
  required: boolean;
  command: string;
  isSet: boolean;
}

export interface PieceSecretInfo {
  name: string;
  displayName: string;
  groups: SecretGroup[];
}

export interface SecretsResponse {
  global: GlobalSecretDef[];
  pieces: PieceSecretInfo[];
}

export interface PieceAction {
  name: string;
  displayName: string;
  description: string | null;
  props: Record<string, PropDef> | null;
  enabled: boolean;
}

export interface PieceTrigger {
  name: string;
  displayName: string;
  description: string | null;
  type: string;
  props: Record<string, PropDef> | null;
  enabled: boolean;
}

export interface PieceUser {
  userId: string;
  displayName: string;
}

export interface PieceInfo {
  name: string;
  displayName: string;
  description: string | null;
  version: string;
  auth: PieceAuth;
  mcpEndpoint: string;
  actions: PieceAction[];
  triggers: PieceTrigger[];
  secrets: SecretGroup[];
  supportsUsers: boolean;
  /** True when the piece can auto-resolve userId from the provider (e.g. Google email). */
  hasAutoUserId: boolean;
  enabled: boolean;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined)
    },
    ...options
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function getLoginUrl(provider: string = 'code'): Promise<{ url: string }> {
  return apiFetch(`/admin/api/login-url?provider=${encodeURIComponent(provider)}`);
}

export async function logout(): Promise<void> {
  await apiFetch('/admin/api/logout', { method: 'POST' });
}

export async function getMe(): Promise<{ userId: string; email: string }> {
  return apiFetch('/admin/api/me');
}

export async function listPieces(): Promise<PieceInfo[]> {
  return apiFetch('/admin/api/pieces');
}

export async function installPiece(name: string): Promise<void> {
  await apiFetch(`/admin/api/pieces/${encodeURIComponent(name)}/install`, { method: 'POST' });
}

export async function uninstallPiece(name: string): Promise<void> {
  await apiFetch(`/admin/api/pieces/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function setPieceItemEnabled(
  pieceName: string,
  kind: 'action' | 'trigger',
  name: string,
  enabled: boolean,
  userId?: string,
): Promise<{ ok: true; pieceName: string; kind: 'action' | 'trigger'; name: string; enabled: boolean; userId: string }> {
  return apiFetch(`/admin/api/pieces/${encodeURIComponent(pieceName)}/${kind}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled, ...(userId ? { userId } : {}) }),
  });
}

export async function listPieceUsers(name: string): Promise<PieceUser[]> {
  const response = await apiFetch<{ users: PieceUser[] }>(
    `/admin/api/pieces/${encodeURIComponent(name)}/users`
  );
  return response.users;
}

export async function deletePieceUser(name: string, userId: string): Promise<void> {
  await apiFetch(
    `/admin/api/pieces/${encodeURIComponent(name)}/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  );
}

export async function getSecrets(): Promise<SecretsResponse> {
  return apiFetch('/admin/api/secrets');
}

// ---------------------------------------------------------------------------
// Trigger groups
// ---------------------------------------------------------------------------

export interface TriggerOwner {
  kind: string;
  label: string;
  ownerKey: string;
}

export interface TriggerDeliveryTarget {
  type: string;
  value: string;
}

export interface TriggerMember {
  subscriptionId: string;
  pieceName: string;
  pieceDisplayName: string;
  triggerName: string;
  triggerDisplayName: string;
  triggerType: string;
  providerWebhookUrl: string;
  createdAt: string;
  owner: TriggerOwner;
  deliveryTarget: TriggerDeliveryTarget;
  method?: string;
  headers?: Record<string, string>;
  args?: string[];
  cwd?: string;
  jqTransform?: string;
}

export interface TriggerGroup {
  endpointKey: string;
  endpointType: 'callbackUrl' | 'queueName' | 'command';
  endpointValue: string;
  memberCount: number;
  members: TriggerMember[];
}

export interface TriggerGroupsResponse {
  groups: TriggerGroup[];
}

export async function getTriggerGroups(): Promise<TriggerGroupsResponse> {
  return apiFetch('/admin/api/triggers/groups');
}

export interface SubscriptionDeliveryBody {
  callbackUrl?: string;
  queueName?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  method?: string;
  headers?: Record<string, string>;
  jqTransform?: string;
  pieceToken?: string;
  userId?: string;
  propsValue?: Record<string, unknown>;
}

export async function createAdminSubscription(
  piece: string,
  trigger: string,
  body: SubscriptionDeliveryBody,
): Promise<{ ok: boolean; id: string }> {
  return apiFetch(`/admin/api/subscriptions/${encodeURIComponent(piece)}/${encodeURIComponent(trigger)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateAdminSubscription(
  piece: string,
  id: string,
  body: SubscriptionDeliveryBody,
): Promise<{ ok: boolean }> {
  return apiFetch(`/admin/api/subscriptions/${encodeURIComponent(piece)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ── Runtime capabilities ────────────────────────────────────────────────────

export interface RuntimeInfo {
  runtime: 'node' | 'workers';
  supportsCliHooks: boolean;
}

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  return apiFetch('/admin/api/runtime');
}

// ── jq transform preview ────────────────────────────────────────────────────

export type JqSampleResponse =
  | { ok: true; input: unknown; result: unknown }
  | { ok: false; input: unknown; error: string };

export async function sampleJqTransform(body: {
  piece?: string;
  trigger?: string;
  program: string;
  sample?: unknown;
}): Promise<JqSampleResponse> {
  return apiFetch('/admin/api/subscriptions/jq-sample', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteAdminSubscription(piece: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/admin/api/subscriptions/${encodeURIComponent(piece)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Test events ───────────────────────────────────────────────────────────

export interface TestEvent {
  id: string;
  receivedAt: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface TestEventsResponse {
  events: TestEvent[];
}

export async function getTestEvents(): Promise<TestEventsResponse> {
  return apiFetch('/admin/api/test-events');
}

export async function clearTestEvents(): Promise<{ ok: boolean; deleted: number }> {
  return apiFetch('/admin/api/test-events', { method: 'DELETE' });
}

export async function runActionAsAdmin(
  pieceName: string,
  actionName: string,
  params: {
    userId?: string;
    pieceToken?: string;
    props?: Record<string, unknown>;
  }
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  return apiFetch<{ ok: true; result: unknown } | { ok: false; error: string }>(
    `/admin/api/run/${encodeURIComponent(pieceName)}/${encodeURIComponent(actionName)}`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}
