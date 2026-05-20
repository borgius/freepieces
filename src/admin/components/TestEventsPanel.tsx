import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Code,
  Flex,
  HStack,
  Heading,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { type TestEvent, clearTestEvents, getTestEvents } from '../lib/api';

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: TestEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      rounded="md"
      overflow="hidden"
      bg="white"
    >
      <Flex
        as="button"
        w="full"
        align="center"
        gap={3}
        px={4}
        py={3}
        textAlign="left"
        _hover={{ bg: 'gray.50' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Badge colorPalette="green" variant="subtle" fontSize="2xs" flexShrink={0}>
          POST
        </Badge>
        <Text fontSize="sm" fontWeight="medium" flex={1} truncate>
          {event.id}
        </Text>
        <Text fontSize="xs" color="gray.400" flexShrink={0}>
          {new Date(event.receivedAt).toLocaleString()}
        </Text>
      </Flex>

      {expanded && (
        <Box borderTopWidth="1px" borderColor="gray.100" px={4} py={3} bg="gray.50">
          {Object.keys(event.headers).length > 0 && (
            <Box mb={3}>
              <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={1}>
                Headers
              </Text>
              <Code
                display="block"
                whiteSpace="pre-wrap"
                fontSize="xs"
                bg="gray.100"
                p={2}
                rounded="sm"
              >
                {Object.entries(event.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n')}
              </Code>
            </Box>
          )}
          <Box>
            <Text fontSize="xs" fontWeight="semibold" color="gray.500" mb={1}>
              Body
            </Text>
            <Code
              display="block"
              whiteSpace="pre-wrap"
              fontSize="xs"
              bg="gray.100"
              p={2}
              rounded="sm"
            >
              {event.body === null
                ? '(no body / non-JSON)'
                : JSON.stringify(event.body, null, 2)}
            </Code>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TestEventsPanel
// ---------------------------------------------------------------------------

export function TestEventsPanel() {
  const [events, setEvents] = useState<TestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getTestEvents();
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  async function handleClear() {
    setClearing(true);
    try {
      await clearTestEvents();
      setEvents([]);
    } finally {
      setClearing(false);
    }
  }

  const testEndpointUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/webhook/test`
      : '/webhook/test';

  return (
    <Box>
      <Flex align="center" justify="space-between" mb={4}>
        <Box>
          <Heading size="md">Test Webhooks</Heading>
          {!loading && !error && (
            <Text fontSize="sm" color="gray.500" mt={1}>
              {events.length === 0
                ? 'No test events received yet'
                : `${events.length} event${events.length === 1 ? '' : 's'} received (newest first)`}
            </Text>
          )}
        </Box>
        <HStack gap={2}>
          <Button size="sm" variant="outline" colorPalette="blue" onClick={fetchEvents} loading={loading}>
            <RefreshCw size={14} />
            Refresh
          </Button>
          {events.length > 0 && (
            <Button size="sm" variant="outline" colorPalette="red" onClick={handleClear} loading={clearing}>
              <Trash2 size={14} />
              Clear
            </Button>
          )}
        </HStack>
      </Flex>

      {/* Endpoint info box */}
      <Box
        borderWidth="1px"
        borderColor="blue.200"
        bg="blue.50"
        rounded="md"
        px={4}
        py={3}
        mb={5}
      >
        <Text fontSize="sm" fontWeight="semibold" color="blue.700" mb={1}>
          Test endpoint
        </Text>
        <Text fontSize="xs" color="blue.600" mb={2}>
          Point a trigger subscription to this URL to capture its delivered events here.
          HTTP is allowed for local dev.
        </Text>
        <Code fontSize="xs" colorPalette="blue">
          {testEndpointUrl}
        </Code>
      </Box>

      {loading && (
        <Flex justify="center" align="center" minH="160px">
          <Spinner size="xl" colorPalette="blue" />
        </Flex>
      )}

      {!loading && error && (
        <Text color="red.500" fontSize="sm">{error}</Text>
      )}

      {!loading && !error && events.length === 0 && (
        <Box
          borderWidth="1px"
          borderColor="gray.200"
          rounded="md"
          p={8}
          textAlign="center"
          bg="white"
        >
          <Text fontSize="sm" color="gray.400">
            No events yet. Create a trigger subscription with the test endpoint URL above,
            then send a webhook or wait for the next polling cycle.
          </Text>
        </Box>
      )}

      {!loading && !error && events.length > 0 && (
        <VStack gap={2} align="stretch">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </VStack>
      )}
    </Box>
  );
}
