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

export interface PieceInfo {
  name: string;
  displayName: string;
  description: string | null;
  version: string;
  auth: { type: string };
  actions: PieceAction[];
  triggers: PieceTrigger[];
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

export async function login(username: string, password: string): Promise<void> {
  await apiFetch('/admin/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function logout(): Promise<void> {
  await apiFetch('/admin/api/logout', { method: 'POST' });
}

export async function getMe(): Promise<{ username: string }> {
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
