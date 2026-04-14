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
  Text,
  VStack,
} from '@chakra-ui/react';
import { type PieceInfo, type SecretGroup, installPiece, uninstallPiece } from '../lib/api';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, KeyRound } from 'lucide-react';
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
        <Box flexShrink={0} color="orange.400">
          <KeyRound size={12} />
        </Box>
        <Box flexShrink={0}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
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

interface Props {
  piece: PieceInfo;
  onToggle: (updated: PieceInfo) => void;
}

export function PieceCard({ piece, onToggle }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const authType =
    Array.isArray(piece.auth)
      ? (piece.auth as Array<{ type: string }>).map((a) => a.type).join(' / ')
      : (piece.auth as { type: string } | undefined)?.type ?? '?';

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
          <Badge colorPalette={authPalette(authType)} variant="outline" fontSize="xs">
            {authLabel(authType)}
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
            items={piece.actions}
          />
        )}

        {piece.triggers.length > 0 && (
          <CollapsibleSection
            title="Triggers"
            count={piece.triggers.length}
            accentColor="purple.400"
            badgeKey="type"
            badgePalette="purple"
            items={piece.triggers}
          />
        )}

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

