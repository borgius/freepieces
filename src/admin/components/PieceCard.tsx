import {
  Badge,
  Box,
  Button,
  Card,
  ClipboardRoot,
  ClipboardTrigger,
  Code,
  Flex,
  HStack,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import {
  type PieceInfo,
  type PieceUser,
  type SecretGroup,
  deletePieceUser,
  installPiece,
  listPieceUsers,
  uninstallPiece,
} from '../lib/api';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, KeyRound, Trash2, Users, Webhook, Zap } from 'lucide-react';
import { CollapsibleSection } from './ItemSection';

const AUTH_PALETTE: Record<string, string> = {
  oauth2: 'purple',
  apiKey: 'orange',
  SECRET_TEXT: 'orange',
  CUSTOM_AUTH: 'yellow',
  OAUTH2: 'purple',
  BASIC_AUTH: 'teal',
  none: 'gray',
};

const AUTH_LABEL: Record<string, string> = {
  oauth2: 'OAuth2',
  apiKey: 'API Key',
  SECRET_TEXT: 'Secret Key',
  CUSTOM_AUTH: 'Custom Auth',
  OAUTH2: 'OAuth2',
  BASIC_AUTH: 'Basic Auth',
  none: 'No Auth',
};

function authLabel(type: string): string {
  return AUTH_LABEL[type] ?? type;
}

function authPalette(type: string): string {
  return AUTH_PALETTE[type] ?? 'gray';
}

function getAuthTypes(auth: PieceInfo['auth']): string[] {
  if (!auth) return [];
  return (Array.isArray(auth) ? auth : [auth]).map((entry) => entry.type);
}

function authDisplayLabel(types: string[]): string {
  if (types.length === 0) return AUTH_LABEL.none;
  return types.map((type) => authLabel(type)).join(' / ');
}

function authDisplayPalette(types: string[]): string {
  if (types.length === 1) return authPalette(types[0]);
  if (types.includes('oauth2') || types.includes('OAUTH2')) return 'purple';
  return 'gray';
}

// --------------------------------------------------------------------------
// SecretsSection — collapsible auth-mode groups with copy-able commands
// --------------------------------------------------------------------------

function SecretsSection({ groups }: { groups: SecretGroup[] }) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;

  // Total required secrets across all groups (for badge in header)
  const totalRequired = groups.reduce((n, g) => n + g.secrets.filter((s) => s.required).length, 0);
  const multiMode = groups.length > 1;

  return (
    <Box mt={3}>
      {/* Section toggle */}
      <Flex
        as="button"
        align="center"
        gap={1.5}
        w="full"
        textAlign="left"
        cursor="pointer"
        _hover={{ color: 'gray.700' }}
        color="gray.500"
        onClick={() => setOpen((s) => !s)}
        mb={open ? 2 : 0}
      >
        <Box flexShrink={0}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Box>
        <Box flexShrink={0} color="orange.400">
          <KeyRound size={12} />
        </Box>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
          Secrets
        </Text>
        <Badge colorPalette={totalRequired > 0 ? 'orange' : 'gray'} variant="subtle" fontSize="2xs" ml={1}>
          {totalRequired}
        </Badge>
        {multiMode && (
          <Text fontSize="xs" color="gray.400" ml={1}>
            {groups.length} auth modes
          </Text>
        )}
      </Flex>

      {open && (
        <VStack align="stretch" gap={3}>
          {groups.map((group, i) => (
            <Box key={group.authType + i}>
              {/* OR divider between modes */}
              {multiMode && (
                <Flex align="center" gap={2} mb={1.5}>
                  {i > 0 && (
                    <Flex align="center" gap={2} w="full">
                      <Box flex={1} h="1px" bg="gray.200" />
                      <Text fontSize="2xs" color="gray.400" fontWeight="semibold" textTransform="uppercase">
                        or
                      </Text>
                      <Box flex={1} h="1px" bg="gray.200" />
                    </Flex>
                  )}
                </Flex>
              )}

              {/* Mode label */}
              {multiMode && (
                <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={1}>
                  {group.displayName}
                </Text>
              )}

              {/* Secret rows */}
              <VStack align="stretch" gap={1.5}>
                {group.secrets.map((s) => (
                  <Box
                    key={s.key}
                    borderWidth="1px"
                    borderColor="orange.100"
                    rounded="md"
                    px={3}
                    py={2}
                    bg="orange.50"
                  >
                    <HStack gap={2} flexWrap="wrap">
                      <Text fontSize="xs" fontWeight="medium" color="gray.800">
                        {s.displayName}
                      </Text>
                      {s.required ? (
                        <Badge colorPalette="red" variant="subtle" fontSize="2xs">required</Badge>
                      ) : (
                        <Badge colorPalette="gray" variant="subtle" fontSize="2xs">optional</Badge>
                      )}
                      {typeof s.isSet === 'boolean' && (
                        <Badge
                          colorPalette={s.isSet ? 'green' : 'red'}
                          variant="subtle"
                          fontSize="2xs"
                        >
                          {s.isSet ? 'Set' : 'Missing'}
                        </Badge>
                      )}
                    </HStack>
                    <HStack gap={1} mt={1} align="center">
                      <Code fontSize="xs" colorPalette="orange" variant="surface" px={1.5} py={0.5}>
                        {s.command}
                      </Code>
                      <ClipboardRoot value={s.command} timeout={1500}>
                        <ClipboardTrigger asChild>
                          <Box
                            as="button"
                            color="gray.400"
                            _hover={{ color: 'orange.500' }}
                            flexShrink={0}
                            title="Copy command"
                          >
                            <Copy size={12} />
                          </Box>
                        </ClipboardTrigger>
                      </ClipboardRoot>
                    </HStack>
                    {s.description && (
                      <Text fontSize="xs" color="gray.500" mt={0.5}>
                        {s.description}
                      </Text>
                    )}
                  </Box>
                ))}
              </VStack>
            </Box>
          ))}
        </VStack>
      )}
    </Box>
  );
}

function UsersSection({ pieceName, isOAuth2, hasAutoUserId }: { pieceName: string; isOAuth2: boolean; hasAutoUserId: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<PieceUser[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      setUsers(await listPieceUsers(pieceName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || loading || users !== null) return;
    await loadUsers();
  }

  async function handleRemoveUser(userId: string) {
    setRemoving(userId);
    setError('');
    try {
      await deletePieceUser(pieceName, userId);
      setUsers((prev) => prev?.filter((u) => u.userId !== userId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    } finally {
      setRemoving(null);
    }
  }

  function handleAddUser() {
    const params = new URLSearchParams({ returnUrl: '/admin' });

    // When the piece can auto-resolve userId from the provider, skip the prompt
    if (!hasAutoUserId) {
      const userId = window.prompt('Enter a user ID for the new OAuth2 connection:');
      if (!userId?.trim()) return;
      params.set('userId', userId.trim());
    }

    const loginUrl = `/auth/login/${encodeURIComponent(pieceName)}?${params}`;
    const popup = window.open(loginUrl, '_blank');

    // Refresh the user list when the popup closes or when this tab regains focus
    function onFocus() {
      window.removeEventListener('focus', onFocus);
      void loadUsers();
    }
    if (popup) {
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          void loadUsers();
        }
      }, 500);
      // Safety: stop polling after 5 minutes
      setTimeout(() => clearInterval(timer), 5 * 60 * 1000);
    } else {
      // Popup blocked — fall back to focus listener
      window.addEventListener('focus', onFocus);
    }
  }

  return (
    <Box mt={3}>
      <Flex
        as="button"
        align="center"
        gap={1.5}
        w="full"
        textAlign="left"
        cursor="pointer"
        _hover={{ color: 'gray.700' }}
        color="gray.500"
        onClick={() => void handleToggle()}
        mb={open ? 2 : 0}
      >
        <Box flexShrink={0}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Box>
        <Box flexShrink={0} color="teal.400">
          <Users size={12} />
        </Box>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
          Users
        </Text>
        {users && (
          <Badge colorPalette={users.length > 0 ? 'teal' : 'gray'} variant="subtle" fontSize="2xs" ml={1}>
            {users.length}
          </Badge>
        )}
        {loading && <Spinner size="xs" ml={1} color="gray.400" />}
      </Flex>

      {open && (
        <VStack align="stretch" gap={1.5}>
          {loading && users === null && (
            <Text fontSize="xs" color="gray.500">
              Loading connected users…
            </Text>
          )}

          {!loading && error && (
            <Text fontSize="xs" color="red.500">
              {error}
            </Text>
          )}

          {!loading && !error && users?.length === 0 && (
            <Text fontSize="xs" color="gray.500">
              No connected users yet.
            </Text>
          )}

          {!loading && !error && users && users.length > 0 && users.map((user) => (
            <Box
              key={user.userId}
              borderWidth="1px"
              borderColor="teal.100"
              rounded="md"
              px={3}
              py={2}
              bg="teal.50"
            >
              <HStack justify="space-between" align="center" gap={2}>
                <VStack align="start" gap={0} minW={0} flex={1}>
                  <Text
                    fontSize="xs"
                    fontWeight="medium"
                    color="gray.800"
                    fontFamily={user.displayName === user.userId ? 'mono' : undefined}
                    lineClamp={1}
                  >
                    {user.displayName}
                  </Text>
                  {user.displayName !== user.userId && (
                    <Text fontSize="xs" color="gray.400" fontFamily="mono" lineClamp={1}>
                      {user.userId}
                    </Text>
                  )}
                </VStack>

                <HStack gap={1} flexShrink={0}>
                  <ClipboardRoot value={user.userId} timeout={1500}>
                    <ClipboardTrigger asChild>
                      <Box
                        as="button"
                        color="gray.400"
                        _hover={{ color: 'teal.500' }}
                        flexShrink={0}
                        title="Copy user id"
                      >
                        <Copy size={12} />
                      </Box>
                    </ClipboardTrigger>
                  </ClipboardRoot>
                  <Box
                    as="button"
                    color="gray.400"
                    _hover={{ color: 'red.500' }}
                    flexShrink={0}
                    title="Remove user"
                    onClick={() => void handleRemoveUser(user.userId)}
                    aria-disabled={removing === user.userId}
                    opacity={removing === user.userId ? 0.5 : 1}
                    pointerEvents={removing === user.userId ? 'none' : undefined}
                  >
                    <Trash2 size={12} />
                  </Box>
                </HStack>
              </HStack>
            </Box>
          ))}

          {isOAuth2 && (
            <Button
              size="xs"
              variant="outline"
              colorPalette="teal"
              onClick={handleAddUser}
            >
              + Add User
            </Button>
          )}
        </VStack>
      )}
    </Box>
  );
}

interface Props {
  piece: PieceInfo;
  onToggle: (updated: PieceInfo) => void;
}

export function PieceCard({ piece, onToggle }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const authTypes = getAuthTypes(piece.auth);

  async function handleToggle() {
    setError('');
    setLoading(true);
    try {
      if (piece.enabled) {
        await uninstallPiece(piece.name);
        onToggle({ ...piece, enabled: false });
      } else {
        await installPiece(piece.name);
        onToggle({ ...piece, enabled: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card.Root
      borderWidth="1px"
      borderColor={piece.enabled ? 'green.200' : 'gray.200'}
      transition="border-color 0.2s"
      _hover={{ shadow: 'md' }}
    >
      <Card.Header pb={2}>
        <Flex justify="space-between" align="flex-start" gap={2}>
          <Box flex={1} minW={0}>
            <Text fontWeight="semibold" fontSize="md" lineClamp={1}>
              {piece.displayName}
            </Text>
            <Text fontSize="xs" color="gray.500" fontFamily="mono">
              {piece.name}
            </Text>
          </Box>
          <Badge
            colorPalette={piece.enabled ? 'green' : 'gray'}
            variant="subtle"
            fontSize="xs"
            flexShrink={0}
          >
            {piece.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </Flex>

        <HStack gap={2} mt={2} flexWrap="wrap">
          <Badge colorPalette={authDisplayPalette(authTypes)} variant="outline" fontSize="xs">
            {authDisplayLabel(authTypes)}
          </Badge>
          <Badge colorPalette="blue" variant="outline" fontSize="xs">
            v{piece.version}
          </Badge>
          {piece.secrets.length > 0 && (
            <Badge colorPalette="orange" variant="subtle" fontSize="xs">
              {piece.secrets.reduce((n, g) => n + g.secrets.filter((s) => s.required).length, 0)} secrets
            </Badge>
          )}
        </HStack>
      </Card.Header>

      <Card.Body py={2}>
        <Text fontSize="sm" color="gray.600" lineClamp={2} minH="2.5rem">
          {piece.description ?? 'No description provided.'}
        </Text>

        {piece.actions.length > 0 && (
          <CollapsibleSection
            title="Actions"
            count={piece.actions.length}
            accentColor="blue.400"
            icon={Zap}
            pieceName={piece.name}
            items={piece.actions}
            kind="action"
          />
        )}

        {piece.triggers.length > 0 && (
          <CollapsibleSection
            title="Triggers"
            count={piece.triggers.length}
            accentColor="purple.400"
            icon={Webhook}
            pieceName={piece.name}
            badgeKey="type"
            badgePalette="purple"
            items={piece.triggers}
            kind="trigger"
          />
        )}

        {piece.supportsUsers && <UsersSection pieceName={piece.name} isOAuth2={authTypes.includes('oauth2') || authTypes.includes('OAUTH2')} hasAutoUserId={piece.hasAutoUserId} />}

        <SecretsSection groups={piece.secrets} />
      </Card.Body>

      <Card.Footer pt={2}>
        <VStack align="stretch" w="full" gap={1}>
          {error && (
            <Text fontSize="xs" color="red.500">
              {error}
            </Text>
          )}
          <Button
            size="sm"
            variant={piece.enabled ? 'outline' : 'solid'}
            colorPalette={piece.enabled ? 'red' : 'green'}
            loading={loading}
            onClick={handleToggle}
            w="full"
          >
            {piece.enabled ? 'Disable' : 'Enable'}
          </Button>
        </VStack>
      </Card.Footer>
    </Card.Root>
  );
}

