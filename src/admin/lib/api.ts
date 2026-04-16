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
}

export interface PieceTrigger {
  name: string;
  displayName: string;
  description: string | null;
  type: string;
  props: Record<string, PropDef> | null;
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

export async function getMe(): Promise<{ email: string }> {
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
