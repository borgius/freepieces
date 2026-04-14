import { Badge, Box, Button, Card, Flex, HStack, Text, VStack } from '@chakra-ui/react';
import { type PieceInfo, installPiece, uninstallPiece } from '../lib/api';
import { useState } from 'react';
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

