import { useState } from 'react';
import { Badge, Box, Button, Flex, HStack, Text, VStack } from '@chakra-ui/react';
import { Plus, Trash2 } from 'lucide-react';
import { type JqSampleResponse, sampleJqTransform } from '../lib/api';
import { InlineInput } from './TriggerInlineControls';

// ---------------------------------------------------------------------------
// EnvHints — shows the env/secret *names* available for ${NAME} injection.
// Values are never exposed; only names are listed.
// ---------------------------------------------------------------------------

export function EnvHints({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <Box mt={1}>
      <Text fontSize="2xs" color="gray.500">
        Inject env vars / secrets with{' '}
        <Text as="span" fontFamily="mono" color="gray.700">{'${NAME}'}</Text>. Available:
      </Text>
      <Flex gap={1} flexWrap="wrap" mt={1}>
        {names.map((n) => (
          <Badge key={n} colorPalette="gray" variant="subtle" fontSize="2xs" fontFamily="mono">
            {'${' + n + '}'}
          </Badge>
        ))}
      </Flex>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// HeadersEditor — repeatable key/value rows for additional request headers.
// ---------------------------------------------------------------------------

export interface HeaderPair { id: string; name: string; value: string }

export function HeadersEditor({
  rows,
  onChange,
}: {
  rows: Array<{ id: string; name: string; value: string }>;
  onChange: (rows: Array<{ id: string; name: string; value: string }>) => void;
}) {
  function update(id: string, patch: Partial<{ name: string; value: string }>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function add() {
    onChange([...rows, { id: crypto.randomUUID(), name: '', value: '' }]);
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  return (
    <VStack align="stretch" gap={1.5}>
      {rows.map((r) => (
        <Flex key={r.id} gap={2} align="center">
          <Box flex={1} minW="100px">
            <InlineInput value={r.name} onChange={(v) => update(r.id, { name: v })} placeholder="Header-Name" />
          </Box>
          <Box flex={2} minW="140px">
            <InlineInput value={r.value} onChange={(v) => update(r.id, { value: v })} placeholder="value or ${SECRET}" />
          </Box>
          <Box
            as="button"
            onClick={() => remove(r.id)}
            color="gray.300"
            _hover={{ color: 'red.400' }}
            flexShrink={0}
            title="Remove header"
          >
            <Trash2 size={13} />
          </Box>
        </Flex>
      ))}
      <Box>
        <Button size="xs" variant="ghost" colorPalette="blue" onClick={add}>
          <Plus size={11} />
          Add header
        </Button>
      </Box>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// ArgsEditor — repeatable CLI argument rows.
// ---------------------------------------------------------------------------

export function ArgsEditor({
  rows,
  onChange,
}: {
  rows: Array<{ id: string; value: string }>;
  onChange: (rows: Array<{ id: string; value: string }>) => void;
}) {
  function update(id: string, value: string) {
    onChange(rows.map((r) => (r.id === id ? { ...r, value } : r)));
  }
  function add() {
    onChange([...rows, { id: crypto.randomUUID(), value: '' }]);
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  return (
    <VStack align="stretch" gap={1.5}>
      {rows.map((r) => (
        <Flex key={r.id} gap={2} align="center">
          <Box flex={1}>
            <InlineInput value={r.value} onChange={(v) => update(r.id, v)} placeholder="argument or ${SECRET}" />
          </Box>
          <Box
            as="button"
            onClick={() => remove(r.id)}
            color="gray.300"
            _hover={{ color: 'red.400' }}
            flexShrink={0}
            title="Remove argument"
          >
            <Trash2 size={13} />
          </Box>
        </Flex>
      ))}
      <Box>
        <Button size="xs" variant="ghost" colorPalette="blue" onClick={add}>
          <Plus size={11} />
          Add argument
        </Button>
      </Box>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// JqTransformField — jq program textarea with a Validate / Preview action.
// ---------------------------------------------------------------------------

export function JqTransformField({
  value,
  onChange,
  piece,
  trigger,
}: {
  value: string;
  onChange: (v: string) => void;
  piece?: string;
  trigger?: string;
}) {
  const [preview, setPreview] = useState<JqSampleResponse | null>(null);
  const [running, setRunning] = useState(false);

  async function runPreview() {
    if (value.trim() === '') return;
    setRunning(true);
    setPreview(null);
    try {
      setPreview(await sampleJqTransform({ piece, trigger, program: value }));
    } catch (err) {
      setPreview({ ok: false, input: null, error: err instanceof Error ? err.message : 'Preview failed' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Box>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='{ text: ("New: " + (.events | length | tostring)) }'
        rows={3}
        style={{
          fontSize: '0.8125rem',
          fontFamily: 'monospace',
          padding: '6px 8px',
          border: '1px solid #CBD5E0',
          borderRadius: '6px',
          background: 'white',
          width: '100%',
          outline: 'none',
          resize: 'vertical',
        }}
      />
      <HStack gap={2} mt={1}>
        <Button size="xs" variant="outline" colorPalette="purple" onClick={runPreview} loading={running} disabled={value.trim() === ''}>
          Validate / Preview
        </Button>
        <Text fontSize="2xs" color="gray.400">
          Standard jq, applied to the {'{ piece, trigger, events }'} envelope before delivery.
        </Text>
      </HStack>
      {preview && (
        <Box mt={1.5}>
          {preview.ok ? (
            <Box borderWidth="1px" borderColor="green.200" rounded="md" bg="green.50" px={2} py={1.5}>
              <Text fontSize="2xs" color="green.700" fontWeight="medium" mb={0.5}>Preview output</Text>
              <Box
                as="pre"
                fontSize="2xs"
                fontFamily="mono"
                color="gray.700"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
              >
                {JSON.stringify(preview.result, null, 2)}
              </Box>
            </Box>
          ) : (
            <Box borderWidth="1px" borderColor="red.200" rounded="md" bg="red.50" px={2} py={1.5}>
              <Text fontSize="2xs" color="red.600" fontFamily="mono" whiteSpace="pre-wrap">{preview.error}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
