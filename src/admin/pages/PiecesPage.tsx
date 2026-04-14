import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Flex,
  Grid,
  Heading,
  Spinner,
  Text
} from '@chakra-ui/react';
import { LogOut, RefreshCw } from 'lucide-react';
import { type PieceInfo, listPieces, logout } from '../lib/api';
import { PieceCard } from '../components/PieceCard';

interface Props {
  username: string;
  onLogout: () => void;
}

export function PiecesPage({ username, onLogout }: Props) {
  const [pieces, setPieces] = useState<PieceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const fetchPieces = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPieces(await listPieces());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pieces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPieces();
  }, [fetchPieces]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      onLogout();
    }
  }

  function handlePieceToggle(updated: PieceInfo) {
    setPieces((prev) =>
      prev.map((p) => (p.name === updated.name ? updated : p))
    );
  }

  const enabled = pieces.filter((p) => p.enabled).length;
  const total = pieces.length;

  return (
    <Box minH="100vh" bg="gray.50">
      {/* Navbar */}
      <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" px={6} py={4}>
        <Flex align="center" justify="space-between" maxW="7xl" mx="auto">
          <Heading size="lg" fontWeight="bold">
            Freepieces Admin
          </Heading>
          <Flex align="center" gap={4}>
            <Text fontSize="sm" color="gray.500">
              {username}
            </Text>
            <Button
              size="sm"
              variant="outline"
              colorPalette="gray"
              loading={loggingOut}
              onClick={handleLogout}
            >
              <LogOut size={14} />
              Sign out
            </Button>
          </Flex>
        </Flex>
      </Box>

      {/* Content */}
      <Container maxW="7xl" py={8}>
        {/* Header row */}
        <Flex align="center" justify="space-between" mb={6}>
          <Box>
            <Heading size="md">Pieces</Heading>
            {!loading && !error && (
              <Text fontSize="sm" color="gray.500" mt={1}>
                {enabled} of {total} enabled
              </Text>
            )}
          </Box>
          <Button
            size="sm"
            variant="outline"
            colorPalette="blue"
            onClick={fetchPieces}
            loading={loading}
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
        </Flex>

        {/* Loading */}
        {loading && (
          <Flex justify="center" align="center" minH="200px">
            <Spinner size="xl" colorPalette="blue" />
          </Flex>
        )}

        {/* Error */}
        {!loading && error && (
          <Alert.Root status="error" rounded="lg" mb={4}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Failed to load pieces</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}

        {/* Empty state */}
        {!loading && !error && pieces.length === 0 && (
          <Flex
            direction="column"
            align="center"
            justify="center"
            minH="200px"
            gap={2}
          >
            <Text color="gray.500">No pieces registered yet.</Text>
            <Text fontSize="sm" color="gray.400">
              Import and register pieces in src/worker.ts to see them here.
            </Text>
          </Flex>
        )}

        {/* Pieces grid */}
        {!loading && !error && pieces.length > 0 && (
          <Grid
            templateColumns={{
              base: '1fr',
              md: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)'
            }}
            gap={4}
          >
            {pieces.map((piece) => (
              <PieceCard
                key={piece.name}
                piece={piece}
                onToggle={handlePieceToggle}
              />
            ))}
          </Grid>
        )}
      </Container>
    </Box>
  );
}
