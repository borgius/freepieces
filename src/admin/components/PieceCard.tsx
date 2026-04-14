import { Badge, Box, Button, Card, Flex, HStack, Text, VStack } from '@chakra-ui/react';
import { type PieceInfo, installPiece, uninstallPiece } from '../lib/api';
import { useState } from 'react';

const AUTH_PALETTE: Record<string, string> = {
  oauth2: 'purple',
  apiKey: 'orange',
  none: 'gray'
};

const AUTH_LABEL: Record<string, string> = {
  oauth2: 'OAuth2',
  apiKey: 'API Key',
  none: 'No Auth'
};

interface Props {
  piece: PieceInfo;
  onToggle: (updated: PieceInfo) => void;
}

export function PieceCard({ piece, onToggle }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
          <Badge colorPalette={AUTH_PALETTE[piece.auth.type] ?? 'gray'} variant="outline" fontSize="xs">
            {AUTH_LABEL[piece.auth.type] ?? piece.auth.type}
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
          <VStack align="stretch" gap={1} mt={3}>
            <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
              Actions ({piece.actions.length})
            </Text>
            {piece.actions.map((action) => (
              <HStack key={action.name} gap={2}>
                <Box
                  w={1.5}
                  h={1.5}
                  bg="blue.400"
                  rounded="full"
                  flexShrink={0}
                  mt={0.5}
                />
                <Text fontSize="xs" color="gray.700">
                  {action.displayName}
                </Text>
              </HStack>
            ))}
          </VStack>
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
