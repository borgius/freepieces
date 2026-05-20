import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Text,
  VStack,
} from '@chakra-ui/react';
import { Plus, Trash2, X } from 'lucide-react';
import { type PieceInfo, createAdminSubscription } from '../lib/api';
import { InlineInput, InlineSelect } from './TriggerInlineControls';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PieceRow {
  id: string;
  pieceName: string;
  selectedTriggers: Set<string>;
}

// ---------------------------------------------------------------------------
// PieceTriggerRow — one piece + its trigger checkboxes
// ---------------------------------------------------------------------------

function PieceTriggerRow({
  row,
  allPieces,
  canRemove,
  onChangePiece,
  onToggleTrigger,
  onRemove,
}: {
  row: PieceRow;
  allPieces: PieceInfo[];
  canRemove: boolean;
  onChangePiece: (pieceName: string) => void;
  onToggleTrigger: (triggerName: string, checked: boolean) => void;
  onRemove: () => void;
}) {
  const selectedPiece = allPieces.find((p) => p.name === row.pieceName);
  const triggers = selectedPiece?.triggers ?? [];

  return (
    <Box borderWidth="1px" borderColor="blue.100" rounded="md" p={2} bg="white">
      <Flex gap={3} flexWrap="wrap" align="flex-start">
        <Box flex={1} minW="140px">
          <Text fontSize="2xs" color="gray.500" mb={1} fontWeight="medium">Piece</Text>
          <InlineSelect
            value={row.pieceName}
            onChange={onChangePiece}
            options={allPieces.map((p) => ({ value: p.name, label: p.displayName }))}
          />
        </Box>

        <Box flex={2} minW="200px">
          <Text fontSize="2xs" color="gray.500" mb={1} fontWeight="medium">Trigger(s)</Text>
          {triggers.length === 0 ? (
            <Text fontSize="xs" color="orange.400">No triggers for this piece</Text>
          ) : (
            <VStack
              align="stretch"
              gap={0.5}
              maxH="120px"
              overflowY="auto"
              borderWidth="1px"
              borderColor="gray.200"
              rounded="md"
              p={1.5}
              bg="gray.50"
            >
              {triggers.map((t) => (
                <label
                  key={t.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.selectedTriggers.has(t.name)}
                    onChange={(e) => onToggleTrigger(t.name, e.target.checked)}
                  />
                  <span style={{ flex: 1 }}>{t.displayName}</span>
                  <Badge colorPalette="purple" variant="subtle" fontSize="2xs">{t.type}</Badge>
                </label>
              ))}
            </VStack>
          )}
        </Box>

        {canRemove && (
          <Box pt={4} flexShrink={0}>
            <Box
              as="button"
              onClick={onRemove}
              color="gray.300"
              _hover={{ color: 'red.400' }}
              title="Remove piece"
            >
              <Trash2 size={13} />
            </Box>
          </Box>
        )}
      </Flex>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// AddTriggerForm — main export
// ---------------------------------------------------------------------------

export function AddTriggerForm({
  pieces,
  onSuccess,
  onCancel,
}: {
  pieces: PieceInfo[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const piecesWithTriggers = pieces.filter((p) => p.triggers.length > 0);
  const defaultPiece = piecesWithTriggers[0]?.name ?? '';

  const [rows, setRows] = useState<PieceRow[]>([
    { id: crypto.randomUUID(), pieceName: defaultPiece, selectedTriggers: new Set() },
  ]);
  const [deliveryType, setDeliveryType] = useState<'callbackUrl' | 'queueName'>('callbackUrl');
  const [deliveryValue, setDeliveryValue] = useState('');
  const [authMode, setAuthMode] = useState<'none' | 'pieceToken' | 'userId'>('none');
  const [authValue, setAuthValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function addRow() {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), pieceName: defaultPiece, selectedTriggers: new Set() }]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function setRowPiece(id: string, pieceName: string) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, pieceName, selectedTriggers: new Set() } : r));
  }

  function toggleRowTrigger(id: string, triggerName: string, checked: boolean) {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = new Set(r.selectedTriggers);
      if (checked) next.add(triggerName);
      else next.delete(triggerName);
      return { ...r, selectedTriggers: next };
    }));
  }

  const totalSelected = rows.reduce((n, r) => n + r.selectedTriggers.size, 0);
  const canSubmit = deliveryValue.trim() !== '' && totalSelected > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      setError('Select at least one trigger and provide a delivery target.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Parameters<typeof createAdminSubscription>[2] = {
        ...(deliveryType === 'callbackUrl' ? { callbackUrl: deliveryValue.trim() } : { queueName: deliveryValue.trim() }),
        ...(authMode === 'pieceToken' && authValue ? { pieceToken: authValue } : {}),
        ...(authMode === 'userId' && authValue ? { userId: authValue } : {}),
      };
      await Promise.all(
        rows.flatMap((r) => [...r.selectedTriggers].map((t) => createAdminSubscription(r.pieceName, t, body))),
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subscriptions');
      setSaving(false);
    }
  }

  return (
    <Box borderWidth="1px" borderColor="blue.200" rounded="lg" px={4} py={4} bg="blue.50" mb={3}>
      <HStack gap={2} mb={3}>
        <Plus size={14} color="var(--chakra-colors-blue-600)" />
        <Text fontSize="sm" fontWeight="semibold" color="blue.700">New Trigger Subscription</Text>
        <Box flex={1} />
        <Box as="button" onClick={onCancel} color="gray.400" _hover={{ color: 'gray.600' }}>
          <X size={14} />
        </Box>
      </HStack>

      <VStack align="stretch" gap={3}>
        {/* Delivery target — first */}
        <Box>
          <Text fontSize="2xs" color="gray.500" mb={1} fontWeight="medium">Delivery target *</Text>
          <Flex gap={2} align="center" flexWrap="wrap">
            <HStack gap={1} flexShrink={0}>
              {(['callbackUrl', 'queueName'] as const).map((t) => (
                <Button
                  key={t}
                  size="xs"
                  variant={deliveryType === t ? 'solid' : 'outline'}
                  colorPalette={deliveryType === t ? 'blue' : 'gray'}
                  onClick={() => { setDeliveryType(t); setDeliveryValue(''); }}
                >
                  {t === 'callbackUrl' ? 'HTTPS URL' : 'Queue name'}
                </Button>
              ))}
            </HStack>
            <Box flex={1} minW="200px">
              <InlineInput
                value={deliveryValue}
                onChange={setDeliveryValue}
                placeholder={deliveryType === 'callbackUrl' ? 'https://your-server.example.com/hook' : 'my-queue-name'}
                autoFocus
              />
            </Box>
          </Flex>
        </Box>

        {/* Authentication — second */}
        <Box>
          <Text fontSize="2xs" color="gray.500" mb={1} fontWeight="medium">Authentication</Text>
          <Flex gap={2} align="center" flexWrap="wrap">
            <HStack gap={1} flexShrink={0}>
              {(['none', 'pieceToken', 'userId'] as const).map((m) => (
                <Button
                  key={m}
                  size="xs"
                  variant={authMode === m ? 'solid' : 'outline'}
                  colorPalette={authMode === m ? 'blue' : 'gray'}
                  onClick={() => { setAuthMode(m); setAuthValue(''); }}
                >
                  {m === 'none' ? 'None' : m === 'pieceToken' ? 'API key' : 'User ID'}
                </Button>
              ))}
            </HStack>
            {authMode !== 'none' && (
              <Box flex={1} minW="180px">
                <InlineInput
                  value={authValue}
                  onChange={setAuthValue}
                  placeholder={authMode === 'pieceToken' ? 'Direct API key / token' : 'user@example.com'}
                />
              </Box>
            )}
          </Flex>
        </Box>

        {/* Piece + trigger rows — third */}
        <Box>
          <HStack mb={1} justify="space-between">
            <Text fontSize="2xs" color="gray.500" fontWeight="medium">Pieces & Triggers *</Text>
            {piecesWithTriggers.length > 0 && (
              <Button size="xs" variant="ghost" colorPalette="blue" onClick={addRow}>
                <Plus size={11} />
                Add piece
              </Button>
            )}
          </HStack>
          {piecesWithTriggers.length === 0 ? (
            <Text fontSize="xs" color="red.400">No pieces with triggers registered</Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {rows.map((row) => (
                <PieceTriggerRow
                  key={row.id}
                  row={row}
                  allPieces={piecesWithTriggers}
                  canRemove={rows.length > 1}
                  onChangePiece={(name) => setRowPiece(row.id, name)}
                  onToggleTrigger={(name, checked) => toggleRowTrigger(row.id, name, checked)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </VStack>
          )}
        </Box>

        {error && <Text fontSize="xs" color="red.500">{error}</Text>}

        <HStack gap={2} justify="flex-end">
          <Button size="sm" variant="ghost" colorPalette="gray" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            colorPalette="blue"
            onClick={handleSubmit}
            loading={saving}
            disabled={!canSubmit}
          >
            Create Subscription{totalSelected > 1 ? `s (${totalSelected})` : ''}
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}
