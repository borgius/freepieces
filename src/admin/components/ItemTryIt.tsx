import { useEffect, useState } from 'react';
import { Alert, Box, Button, Flex, Spinner, Text, VStack } from '@chakra-ui/react';
import { Play } from 'lucide-react';
import { type PieceAuth, type PieceUser, type PropDef, listPieceUsers, runActionAsAdmin } from '../lib/api';
import { CodeBlock } from './ItemUsage';

// --------------------------------------------------------------------------
// Auth type helpers
// --------------------------------------------------------------------------

function getAuthTypes(auth: PieceAuth): string[] {
  if (!auth) return [];
  return (Array.isArray(auth) ? auth : [auth]).map((a) => a.type);
}

function isOAuth2(auth: PieceAuth): boolean {
  const types = getAuthTypes(auth);
  return types.includes('oauth2') || types.includes('OAUTH2');
}

function needsPieceToken(auth: PieceAuth): boolean {
  const types = getAuthTypes(auth);
  return types.some((t) => ['apiKey', 'SECRET_TEXT', 'CUSTOM_AUTH', 'BASIC_AUTH'].includes(t));
}

// --------------------------------------------------------------------------
// Value parsing
// --------------------------------------------------------------------------

function parseValue(type: string, raw: string): unknown {
  if (raw === '') return undefined;
  if (type === 'NUMBER') return parseFloat(raw);
  if (type === 'JSON' || type === 'OBJECT' || type === 'ARRAY') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

// --------------------------------------------------------------------------
// Shared input style
// --------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  padding: '4px 8px',
  border: '1px solid #CBD5E0',
  borderRadius: '6px',
  background: 'white',
  width: '100%',
  outline: 'none',
};

// --------------------------------------------------------------------------
// ActionTryItTab
// --------------------------------------------------------------------------

export function ActionTryItTab({
  pieceName,
  actionName,
  props,
  pieceAuth,
  pieceSupportsUsers,
}: {
  pieceName: string;
  actionName: string;
  props: Record<string, PropDef> | null;
  pieceAuth: PieceAuth;
  pieceSupportsUsers: boolean;
}) {
  const propEntries = props ? Object.entries(props) : [];

  // String values for text-like inputs
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [key, def] of propEntries) {
      if (def.type !== 'CHECKBOX') {
        init[key] = def.defaultValue != null ? String(def.defaultValue) : '';
      }
    }
    return init;
  });

  // Boolean values for CHECKBOX inputs
  const [checkboxValues, setCheckboxValues] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const [key, def] of propEntries) {
      if (def.type === 'CHECKBOX') {
        init[key] = Boolean(def.defaultValue ?? false);
      }
    }
    return init;
  });

  // Auth state
  const [userId, setUserId] = useState('');
  const [pieceToken, setPieceToken] = useState('');

  // User selector
  const [users, setUsers] = useState<PieceUser[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  // Run state
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const [resultSet, setResultSet] = useState(false);
  const [runError, setRunError] = useState('');

  const showUserSelector = pieceSupportsUsers && isOAuth2(pieceAuth);
  const showPieceToken = !showUserSelector && needsPieceToken(pieceAuth);

  useEffect(() => {
    if (!showUserSelector) return;
    setUsersLoading(true);
    setUsersError('');
    listPieceUsers(pieceName)
      .then((u) => { setUsers(u); })
      .catch((err) => { setUsersError(err instanceof Error ? err.message : 'Failed to load users'); })
      .finally(() => { setUsersLoading(false); });
  }, [pieceName, showUserSelector]);

  async function handleRun() {
    setRunning(true);
    setResultSet(false);
    setRunError('');
    setResult(undefined);

    // Build props object — omit undefined values
    const builtProps: Record<string, unknown> = {};
    for (const [key, def] of propEntries) {
      if (def.type === 'CHECKBOX') {
        builtProps[key] = checkboxValues[key] ?? false;
      } else if (def.type === 'FILE') {
        // File upload not supported — omit
      } else {
        const parsed = parseValue(def.type, values[key] ?? '');
        if (parsed !== undefined) builtProps[key] = parsed;
      }
    }

    try {
      const response = await runActionAsAdmin(pieceName, actionName, {
        props: builtProps,
        ...(showUserSelector && userId ? { userId } : {}),
        ...(showPieceToken && pieceToken ? { pieceToken } : {}),
      });

      if (response.ok) {
        setResult(response.result);
      } else {
        setRunError(response.error);
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Action execution failed');
    } finally {
      setRunning(false);
      setResultSet(true);
    }
  }

  return (
    <VStack align="stretch" gap={4}>
      {/* User selector (OAuth2 pieces) */}
      {showUserSelector && (
        <Box>
          <Text fontSize="xs" fontWeight="medium" color="gray.600" mb={1}>Connected User</Text>
          {usersLoading && <Flex align="center" gap={2}><Spinner size="sm" /><Text fontSize="xs" color="gray.500">Loading users…</Text></Flex>}
          {!usersLoading && usersError && (
            <Text fontSize="xs" color="red.500">{usersError}</Text>
          )}
          {!usersLoading && !usersError && (
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— no user / use pieceToken —</option>
              {(users ?? []).map((u) => (
                <option key={u.userId} value={u.userId}>{u.displayName}</option>
              ))}
            </select>
          )}
        </Box>
      )}

      {/* pieceToken input (apiKey / SECRET_TEXT / CUSTOM_AUTH / BASIC_AUTH) */}
      {showPieceToken && (
        <Box>
          <Text fontSize="xs" fontWeight="medium" color="gray.600" mb={1}>Piece Token / API Key</Text>
          <input
            type="password"
            value={pieceToken}
            onChange={(e) => setPieceToken(e.target.value)}
            placeholder="Enter token or API key"
            style={inputStyle}
          />
        </Box>
      )}

      {/* Props form */}
      {propEntries.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={2}>
            Parameters
          </Text>
          <VStack align="stretch" gap={3}>
            {propEntries.map(([key, def]) => (
              <Box key={key}>
                <Flex align="baseline" gap={1} mb={0.5} flexWrap="wrap">
                  <Text fontSize="xs" fontWeight="medium" color="gray.700" fontFamily="mono">{key}</Text>
                  {def.required && <Text fontSize="2xs" color="red.400">required</Text>}
                  {def.displayName !== key && (
                    <Text fontSize="xs" color="gray.500">{def.displayName}</Text>
                  )}
                </Flex>

                {def.type === 'FILE' ? (
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">File upload not supported in Try it</Text>
                ) : def.type === 'CHECKBOX' ? (
                  <Flex align="center" gap={2}>
                    <input
                      type="checkbox"
                      checked={checkboxValues[key] ?? false}
                      onChange={(e) => setCheckboxValues((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    <Text fontSize="xs" color="gray.600">{def.description ?? def.displayName}</Text>
                  </Flex>
                ) : def.type === 'LONG_TEXT' || def.type === 'JSON' || def.type === 'OBJECT' || def.type === 'ARRAY' ? (
                  <textarea
                    value={values[key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={def.type === 'JSON' || def.type === 'OBJECT' || def.type === 'ARRAY' ? 'JSON value' : ''}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: def.type === 'JSON' || def.type === 'OBJECT' || def.type === 'ARRAY' ? 'monospace' : undefined }}
                  />
                ) : def.type === 'DATE_TIME' ? (
                  <input
                    type="datetime-local"
                    value={values[key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={inputStyle}
                  />
                ) : def.type === 'NUMBER' ? (
                  <input
                    type="number"
                    value={values[key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={inputStyle}
                  />
                ) : (
                  <input
                    type="text"
                    value={values[key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={def.description ?? ''}
                    style={inputStyle}
                  />
                )}

                {def.description && def.type !== 'CHECKBOX' && (
                  <Text fontSize="2xs" color="gray.400" mt={0.5}>{def.description}</Text>
                )}
              </Box>
            ))}
          </VStack>
        </Box>
      )}

      {/* Run button */}
      <Box>
        <Button
          size="sm"
          colorPalette="blue"
          onClick={handleRun}
          disabled={running}
          loading={running}
        >
          <Play size={12} />
          Run action
        </Button>
      </Box>

      {/* Result / error */}
      {resultSet && !runError && (
        <CodeBlock
          label="Response"
          code={JSON.stringify(result, null, 2)}
        />
      )}

      {resultSet && runError && (
        <Alert.Root status="error" rounded="md">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Action failed</Alert.Title>
            <Alert.Description>{runError}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </VStack>
  );
}
