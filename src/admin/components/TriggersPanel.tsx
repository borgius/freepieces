import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Code,
  Flex,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { Plus, RefreshCw } from 'lucide-react';
import { type PieceInfo, type TriggerGroupsResponse, getTriggerGroups, listPieces } from '../lib/api';
import { TriggerGroupRow } from './TriggerGroupRow';
import { AddTriggerForm } from './AddTriggerForm';

export function TriggersPanel() {
  const [data, setData] = useState<TriggerGroupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [pieces, setPieces] = useState<PieceInfo[]>([]);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getTriggerGroups());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trigger groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    listPieces().then(setPieces).catch(() => {});
  }, []);

  const totalTriggers = data?.groups.reduce((n, g) => n + g.memberCount, 0) ?? 0;

  function handleAddSuccess() {
    setShowAddForm(false);
    void fetchGroups();
  }

  return (
    <Box>
      <Flex align="center" justify="space-between" mb={4}>
        <Box>
          <Heading size="md">Triggers</Heading>
          {!loading && !error && data && (
            <Text fontSize="sm" color="gray.500" mt={1}>
              {data.groups.length === 0
                ? 'No active trigger subscriptions'
                : `${data.groups.length} delivery endpoint${data.groups.length === 1 ? '' : 's'}, ${totalTriggers} subscription${totalTriggers === 1 ? '' : 's'}`}
            </Text>
          )}
        </Box>
        <HStack gap={2}>
          <Button size="sm" variant="outline" colorPalette="blue" onClick={fetchGroups} loading={loading}>
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button
            size="sm"
            colorPalette="blue"
            variant={showAddForm ? 'solid' : 'outline'}
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus size={14} />
            Add Trigger
          </Button>
        </HStack>
      </Flex>

      {showAddForm && (
        <AddTriggerForm
          pieces={pieces}
          onSuccess={handleAddSuccess}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {loading && (
        <Flex justify="center" align="center" minH="200px">
          <Spinner size="xl" colorPalette="blue" />
        </Flex>
      )}

      {!loading && error && (
        <Text color="red.500" fontSize="sm">{error}</Text>
      )}

      {!loading && !error && data && data.groups.length === 0 && !showAddForm && (
        <Box
          borderWidth="1px"
          borderColor="gray.200"
          rounded="lg"
          px={6}
          py={10}
          textAlign="center"
          bg="gray.50"
        >
          <Text fontSize="sm" color="gray.500">
            No trigger subscriptions found.{' '}
            <Box as="button" color="blue.500" textDecoration="underline" onClick={() => setShowAddForm(true)}>
              Add one now
            </Box>{' '}
            or create via <Code fontSize="xs">POST /subscriptions/:piece/:trigger</Code>.
          </Text>
        </Box>
      )}

      {!loading && !error && data && data.groups.length > 0 && (
        <VStack align="stretch" gap={3}>
          {data.groups.map((group) => (
            <TriggerGroupRow key={group.endpointKey} group={group} onRefresh={fetchGroups} />
          ))}
        </VStack>
      )}
    </Box>
  );
}
