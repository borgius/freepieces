import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  ClipboardRoot,
  ClipboardTrigger,
  Code,
  Flex,
  HStack,
  Heading,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { Copy, RefreshCw } from 'lucide-react';
import { type GlobalSecretDef, type PieceSecretInfo, type SecretDef, getSecrets } from '../lib/api';

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ isSet, required }: { isSet: boolean; required: boolean }) {
  const palette = isSet ? 'green' : required ? 'red' : 'yellow';
  return (
    <Badge
      colorPalette={palette}
      variant="subtle"
      fontSize="2xs"
      flexShrink={0}
    >
      {isSet ? 'Set' : 'Missing'}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// SecretRow — single secret entry
// ---------------------------------------------------------------------------

function SecretRow({ secret }: { secret: (SecretDef | GlobalSecretDef) & { isSet?: boolean } }) {
  const isSet = secret.isSet;
  const missingRequired = isSet === false && secret.required;
  const missingOptional = isSet === false && !secret.required;
  return (
    <Box
      borderWidth="1px"
      borderColor={missingRequired ? 'red.100' : missingOptional ? 'yellow.200' : isSet === true ? 'green.100' : 'orange.100'}
      rounded="md"
      px={3}
      py={2}
      bg={missingRequired ? 'red.50' : missingOptional ? 'yellow.50' : isSet === true ? 'green.50' : 'orange.50'}
    >
      <HStack gap={2} flexWrap="wrap">
        <Text fontSize="xs" fontWeight="semibold" color="gray.800" fontFamily="mono">
          {secret.key}
        </Text>
        <Text fontSize="xs" color="gray.600">
          {secret.displayName}
        </Text>
        {secret.required ? (
          <Badge colorPalette="orange" variant="subtle" fontSize="2xs">required</Badge>
        ) : (
          <Badge colorPalette="gray" variant="subtle" fontSize="2xs">optional</Badge>
        )}
        {typeof isSet === 'boolean' && <StatusBadge isSet={isSet} required={secret.required} />}
      </HStack>

      {secret.description && (
        <Text fontSize="xs" color="gray.500" mt={0.5}>
          {secret.description}
        </Text>
      )}

      <HStack gap={1} mt={1.5} align="center">
        <Code
          fontSize="xs"
          colorPalette={missingRequired ? 'red' : missingOptional ? 'yellow' : 'orange'}
          variant="surface"
          px={1.5}
          py={0.5}
        >
          {secret.command}
        </Code>
        <ClipboardRoot value={secret.command} timeout={1500}>
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
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PieceSecretsGroup — per-piece collapsible block
// ---------------------------------------------------------------------------

function PieceSecretsGroup({ piece }: { piece: PieceSecretInfo }) {
  const total = piece.groups.reduce((n, g) => n + g.secrets.length, 0);
  const missing = piece.groups.reduce(
    (n, g) => n + g.secrets.filter((s) => s.isSet === false).length,
    0,
  );

  return (
    <Box>
      <HStack gap={2} mb={2}>
        <Text fontSize="sm" fontWeight="semibold" color="gray.700">
          {piece.displayName}
        </Text>
        <Text fontSize="xs" color="gray.400" fontFamily="mono">
          {piece.name}
        </Text>
        {missing > 0 ? (
          <Badge colorPalette="red" variant="subtle" fontSize="2xs">{missing} missing</Badge>
        ) : (
          <Badge colorPalette="green" variant="subtle" fontSize="2xs">all set ({total})</Badge>
        )}
      </HStack>

      <VStack align="stretch" gap={2} pl={3} borderLeftWidth="2px" borderColor="gray.100">
        {piece.groups.map((group, i) => (
          <Box key={group.authType + i}>
            {piece.groups.length > 1 && (
              <Text fontSize="2xs" fontWeight="semibold" color="gray.400" textTransform="uppercase" mb={1}>
                {group.displayName}
              </Text>
            )}
            <VStack align="stretch" gap={1.5}>
              {group.secrets.map((s) => (
                <SecretRow key={s.key} secret={s} />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SecretsPanel — main export
// ---------------------------------------------------------------------------

export function SecretsPanel() {
  const [data, setData] = useState<{ global: GlobalSecretDef[]; pieces: PieceSecretInfo[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSecrets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getSecrets());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load secrets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSecrets();
  }, [fetchSecrets]);

  const globalMissing = data?.global.filter((s) => s.required && !s.isSet).length ?? 0;
  const pieceMissing = data?.pieces.reduce(
    (n, p) => n + p.groups.reduce((m, g) => m + g.secrets.filter((s) => !s.isSet).length, 0),
    0,
  ) ?? 0;

  return (
    <Box>
      <Flex align="center" justify="space-between" mb={6}>
        <Box>
          <Heading size="md">Secrets</Heading>
          {!loading && !error && data && (
            <Text fontSize="sm" color="gray.500" mt={1}>
              {globalMissing + pieceMissing === 0
                ? 'All secrets are configured'
                : `${globalMissing + pieceMissing} secret${globalMissing + pieceMissing === 1 ? '' : 's'} missing`}
            </Text>
          )}
        </Box>
        <Button size="sm" variant="outline" colorPalette="blue" onClick={fetchSecrets} loading={loading}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </Flex>

      {loading && (
        <Flex justify="center" align="center" minH="200px">
          <Spinner size="xl" colorPalette="blue" />
        </Flex>
      )}

      {!loading && error && (
        <Text color="red.500" fontSize="sm">{error}</Text>
      )}

      {!loading && !error && data && (
        <VStack align="stretch" gap={8}>
          {/* ── Global secrets ──────────────────────────────────────────── */}
          <Box>
            <HStack gap={2} mb={3}>
              <Heading size="sm" color="gray.700">Global</Heading>
              {globalMissing > 0 ? (
                <Badge colorPalette="red" variant="subtle">{globalMissing} missing</Badge>
              ) : (
                <Badge colorPalette="green" variant="subtle">all set</Badge>
              )}
            </HStack>
            <VStack align="stretch" gap={2}>
              {data.global.map((s) => (
                <SecretRow key={s.key} secret={s} />
              ))}
            </VStack>
          </Box>

          {/* ── Per-piece secrets ────────────────────────────────────────── */}
          {data.pieces.length > 0 && (
            <Box>
              <HStack gap={2} mb={3}>
                <Heading size="sm" color="gray.700">Per-Piece Secrets</Heading>
                {pieceMissing > 0 ? (
                  <Badge colorPalette="red" variant="subtle">{pieceMissing} missing</Badge>
                ) : (
                  <Badge colorPalette="green" variant="subtle">all set</Badge>
                )}
              </HStack>
              <VStack align="stretch" gap={6}>
                {data.pieces.map((piece) => (
                  <PieceSecretsGroup key={piece.name} piece={piece} />
                ))}
              </VStack>
            </Box>
          )}

          {data.pieces.length === 0 && (
            <Text fontSize="sm" color="gray.400">No piece-specific secrets found.</Text>
          )}
        </VStack>
      )}
    </Box>
  );
}
