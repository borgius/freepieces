export interface UserToolState {
  version: 1;
  disabledActions: string[];
  disabledTriggers: string[];
}

interface MutableUserToolState {
  disabledActions: Set<string>;
  disabledTriggers: Set<string>;
}

const USER_TOOL_STATE_VERSION = 1;

const EMPTY_USER_TOOL_STATE: UserToolState = {
  version: USER_TOOL_STATE_VERSION,
  disabledActions: [],
  disabledTriggers: [],
};

export function USER_TOOL_STATE_KEY(userId: string, pieceName: string): string {
  return `__admin:user-tool-state:${userId}:${pieceName}`;
}

function normalizeEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )].sort();
}

function normalizeState(value: unknown): UserToolState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_USER_TOOL_STATE;
  }

  const record = value as {
    disabledActions?: unknown;
    disabledTriggers?: unknown;
  };

  return {
    version: USER_TOOL_STATE_VERSION,
    disabledActions: normalizeEntries(record.disabledActions),
    disabledTriggers: normalizeEntries(record.disabledTriggers),
  };
}

function toMutableState(state: UserToolState): MutableUserToolState {
  return {
    disabledActions: new Set(state.disabledActions),
    disabledTriggers: new Set(state.disabledTriggers),
  };
}

function toPersistedState(state: MutableUserToolState): UserToolState {
  return {
    version: USER_TOOL_STATE_VERSION,
    disabledActions: [...state.disabledActions].sort(),
    disabledTriggers: [...state.disabledTriggers].sort(),
  };
}

function isEmptyState(state: UserToolState): boolean {
  return state.disabledActions.length === 0 && state.disabledTriggers.length === 0;
}

export async function loadUserToolState(
  kv: KVNamespace,
  userId: string | undefined,
  pieceName: string,
): Promise<UserToolState> {
  if (!userId) {
    return EMPTY_USER_TOOL_STATE;
  }

  const raw = await kv.get(USER_TOOL_STATE_KEY(userId, pieceName));
  if (!raw) {
    return EMPTY_USER_TOOL_STATE;
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return EMPTY_USER_TOOL_STATE;
  }
}

export function isActionEnabledInState(state: UserToolState, actionName: string): boolean {
  return !state.disabledActions.includes(actionName);
}

export function isTriggerEnabledInState(state: UserToolState, triggerName: string): boolean {
  return !state.disabledTriggers.includes(triggerName);
}

export async function isActionEnabledForUser(
  kv: KVNamespace,
  userId: string | undefined,
  pieceName: string,
  actionName: string,
): Promise<boolean> {
  const state = await loadUserToolState(kv, userId, pieceName);
  return isActionEnabledInState(state, actionName);
}

export async function isTriggerEnabledForUser(
  kv: KVNamespace,
  userId: string | undefined,
  pieceName: string,
  triggerName: string,
): Promise<boolean> {
  const state = await loadUserToolState(kv, userId, pieceName);
  return isTriggerEnabledInState(state, triggerName);
}

async function updateUserToolState(
  kv: KVNamespace,
  userId: string,
  pieceName: string,
  updater: (state: MutableUserToolState) => void,
): Promise<UserToolState> {
  const nextState = toMutableState(await loadUserToolState(kv, userId, pieceName));
  updater(nextState);

  const persisted = toPersistedState(nextState);
  const key = USER_TOOL_STATE_KEY(userId, pieceName);

  if (isEmptyState(persisted)) {
    await kv.delete(key);
    return persisted;
  }

  await kv.put(key, JSON.stringify(persisted));
  return persisted;
}

export async function setActionEnabledForUser(
  kv: KVNamespace,
  userId: string,
  pieceName: string,
  actionName: string,
  enabled: boolean,
): Promise<UserToolState> {
  return updateUserToolState(kv, userId, pieceName, (state) => {
    if (enabled) {
      state.disabledActions.delete(actionName);
      return;
    }

    state.disabledActions.add(actionName);
  });
}

export async function setTriggerEnabledForUser(
  kv: KVNamespace,
  userId: string,
  pieceName: string,
  triggerName: string,
  enabled: boolean,
): Promise<UserToolState> {
  return updateUserToolState(kv, userId, pieceName, (state) => {
    if (enabled) {
      state.disabledTriggers.delete(triggerName);
      return;
    }

    state.disabledTriggers.add(triggerName);
  });
}
