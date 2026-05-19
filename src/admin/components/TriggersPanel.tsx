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
import { Check, ChevronDown, ChevronRight, Copy, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  type PieceInfo,
  type TriggerGroup,
  type TriggerGroupsResponse,
  createAdminSubscription,
  deleteAdminSubscription,
  getTriggerGroups,
  listPieces,
  updateAdminSubscription,
} from '../lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function endpointTypeLabel(type: string): string {
  return type === 'callbackUrl' ? 'HTTPS callback' : 'Cloudflare Queue';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Inline text input
// ---------------------------------------------------------------------------

function InlineInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        fontSize: '0.875rem',
        fontFamily: 'monospace',
        padding: '4px 8px',
        border: '1px solid #CBD5E0',
        borderRadius: '6px',
        background: 'white',
        width: '100%',
        outline: 'none',
      }}
    />
  );
}

function InlineSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: '0.875rem',
        padding: '4px 8px',
        border: '1px solid #CBD5E0',
        borderRadius: '6px',
        background: 'white',
        width: '100%',
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// TriggerMemberRow
// ---------------------------------------------------------------------------

function TriggerMemberRow({
  member,
  pieceName,
  onDelete,
}: {
  member: TriggerGroup['members'][number];
  pieceName: string;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAdminSubscription(pieceName, member.subscriptionId);
      onDelete();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Box borderWidth="1px" borderColor="gray.100" rounded="md" px={3} py={2} bg="white">
      <Flex align="flex-start" gap={2}>
        <Box flex={1} minW={0}>
          <HStack gap={2} flexWrap="wrap">
            <Text fontSize="xs" fontWeight="semibold" color="gray.800">{member.pieceDisplayName}</Text>
            <Text fontSize="xs" color="gray.500" fontFamily="mono">{member.pieceName}</Text>
            <Text fontSize="xs" color="gray.500">·</Text>
            <Text fontSize="xs" color="gray.700">{member.triggerDisplayName}</Text>
            <Badge colorPalette="purple" variant="subtle" fontSize="2xs">{member.triggerType}</Badge>
          </HStack>

          <VStack align="stretch" gap={0.5} mt={1.5}>
            <HStack gap={1.5} align="center">
              <Text fontSize="2xs" color="gray.400" w="28" flexShrink={0}>Provider URL</Text>
              <Code fontSize="2xs" colorPalette="gray" variant="surface" px={1.5} py={0.5} wordBreak="break-all">
                {member.providerWebhookUrl}
              </Code>
              <ClipboardRoot value={member.providerWebhookUrl} timeout={1500}>
                <ClipboardTrigger asChild>
                  <Box as="button" color="gray.300" _hover={{ color: 'blue.500' }} flexShrink={0} title="Copy">
                    <Copy size={10} />
                  </Box>
                </ClipboardTrigger>
              </ClipboardRoot>
            </HStack>
            <HStack gap={1.5} align="center">
              <Text fontSize="2xs" color="gray.400" w="28" flexShrink={0}>Owner</Text>
              <Text fontSize="2xs" color="gray.600">{member.owner.label}</Text>
              <Badge colorPalette="gray" variant="subtle" fontSize="2xs">{member.owner.kind}</Badge>
            </HStack>
            <HStack gap={1.5} align="center">
              <Text fontSize="2xs" color="gray.400" w="28" flexShrink={0}>ID</Text>
              <Text fontSize="2xs" color="gray.500" fontFamily="mono">{member.subscriptionId}</Text>
            </HStack>
            <HStack gap={1.5} align="center">
              <Text fontSize="2xs" color="gray.400" w="28" flexShrink={0}>Created</Text>
              <Text fontSize="2xs" color="gray.500">{formatDate(member.createdAt)}</Text>
            </HStack>
          </VStack>
        </Box>

        <Box flexShrink={0} pt={0.5}>
          {confirmDelete ? (
            <HStack gap={1}>
              <Box
                as="button"
                title="Confirm delete"
                onClick={handleDelete}
                color={deleting ? 'gray.300' : 'red.500'}
                _hover={{ color: 'red.700' }}
                cursor={deleting ? 'not-allowed' : 'pointer'}
              >
                {deleting ? <Spinner size="xs" /> : <Check size={13} />}
              </Box>
              <Box
                as="button"
                title="Cancel"
                onClick={() => setConfirmDelete(false)}
                color="gray.400"
                _hover={{ color: 'gray.600' }}
              >
                <X size={13} />
              </Box>
            </HStack>
          ) : (
            <Box
              as="button"
              title="Delete subscription"
              onClick={() => setConfirmDelete(true)}
              color="gray.300"
              _hover={{ color: 'red.400' }}
            >
              <Trash2 size={13} />
            </Box>
          )}
        </Box>
      </Flex>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TriggerGroupRow
// ---------------------------------------------------------------------------

function TriggerGroupRow({
  group,
  onRefresh,
}: {
  group: TriggerGroup;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(group.endpointValue);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      const body = group.endpointType === 'callbackUrl'
        ? { callbackUrl: editValue }
        : { queueName: editValue };
      await Promise.all(
        group.members.map((m) => updateAdminSubscription(m.pieceName, m.subscriptionId, body)),
      );
      setEditing(false);
      onRefresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditValue(group.endpointValue);
    setSaveError('');
    setEditing(false);
  }

  return (
    <Box borderWidth="1px" borderColor="gray.200" rounded="lg" overflow="hidden">
      <Flex align="center" gap={3} px={4} py={3} bg="white">
        <Box
          as="button"
          color="gray.400"
          flexShrink={0}
          onClick={() => setExpanded((v) => !v)}
          cursor="pointer"
          _hover={{ color: 'gray.600' }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Box>

        <Box
          flex={1}
          minW={0}
          onClick={() => !editing && setExpanded((v) => !v)}
          cursor={editing ? 'default' : 'pointer'}
        >
          {editing ? (
            <VStack align="stretch" gap={1}>
              <HStack gap={2}>
                <Badge
                  colorPalette={group.endpointType === 'callbackUrl' ? 'blue' : 'violet'}
                  variant="subtle"
                  fontSize="2xs"
                >
                  {endpointTypeLabel(group.endpointType)}
                </Badge>
                <Text fontSize="2xs" color="gray.400">Edit endpoint</Text>
              </HStack>
              <InlineInput
                value={editValue}
                onChange={setEditValue}
                placeholder={group.endpointType === 'callbackUrl' ? 'https://…' : 'queue-name'}
                autoFocus
              />
              {saveError && <Text fontSize="2xs" color="red.500">{saveError}</Text>}
            </VStack>
          ) : (
            <HStack gap={2} flexWrap="wrap">
              <Badge
                colorPalette={group.endpointType === 'callbackUrl' ? 'blue' : 'violet'}
                variant="subtle"
                fontSize="2xs"
              >
                {endpointTypeLabel(group.endpointType)}
              </Badge>
              <Code fontSize="xs" colorPalette="gray" variant="surface" px={1.5} py={0.5} wordBreak="break-all">
                {group.endpointValue}
              </Code>
            </HStack>
          )}
        </Box>

        <HStack gap={2} flexShrink={0}>
          {!editing && (
            <Badge colorPalette="gray" variant="subtle" fontSize="2xs">
              {group.memberCount} {group.memberCount === 1 ? 'trigger' : 'triggers'}
            </Badge>
          )}

          {editing ? (
            <>
              <Box
                as="button"
                title="Save"
                onClick={handleSave}
                color={saving ? 'gray.300' : 'green.500'}
                _hover={{ color: 'green.700' }}
                cursor={saving ? 'not-allowed' : 'pointer'}
              >
                {saving ? <Spinner size="xs" /> : <Check size={14} />}
              </Box>
              <Box as="button" title="Cancel" onClick={cancelEdit} color="gray.400" _hover={{ color: 'gray.600' }}>
                <X size={14} />
              </Box>
            </>
          ) : (
            <Box
              as="button"
              title="Edit endpoint"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditing(true); }}
              color="gray.300"
              _hover={{ color: 'blue.400' }}
            >
              <Pencil size={13} />
            </Box>
          )}
        </HStack>
      </Flex>

      {expanded && (
        <Box px={4} py={3} bg="gray.50" borderTopWidth="1px" borderColor="gray.100">
          <VStack align="stretch" gap={2}>
            {group.members.map((member) => (
              <TriggerMemberRow
                key={member.subscriptionId}
                member={member}
                pieceName={member.pieceName}
                onDelete={onRefresh}
              />
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// AddTriggerForm
// ---------------------------------------------------------------------------

function AddTriggerForm({
  pieces,
  onSuccess,
  onCancel,
}: {
  pieces: PieceInfo[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const webhookPieces = pieces.filter((p) =>
    p.triggers.some((t) => t.type === 'WEBHOOK' || t.type === 'APP_WEBHOOK'),
  );

  const [pieceName, setPieceName] = useState(webhookPieces[0]?.name ?? '');
  const [triggerName, setTriggerName] = useState('');
  const [deliveryType, setDeliveryType] = useState<'callbackUrl' | 'queueName'>('callbackUrl');
  const [deliveryValue, setDeliveryValue] = useState('');
  const [authMode, setAuthMode] = useState<'none' | 'pieceToken' | 'userId'>('none');
  const [authValue, setAuthValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedPiece = webhookPieces.find((p) => p.name === pieceName);
  const webhookTriggers = selectedPiece?.triggers.filter(
    (t) => t.type === 'WEBHOOK' || t.type === 'APP_WEBHOOK',
  ) ?? [];

  useEffect(() => {
    setTriggerName(webhookTriggers[0]?.name ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceName]);

  async function handleSubmit() {
    if (!pieceName || !triggerName || !deliveryValue.trim()) {
      setError('Please fill in all required fields.');
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
      await createAdminSubscription(pieceName, triggerName, body);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subscription');
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
        <Flex gap={3} flexWrap="wrap">
          <Box flex={1} minW="160px">
            <Text fontSize="2xs" color="gray.500" mb={1} fontWeight="medium">Piece *</Text>
            {webhookPieces.length === 0 ? (
              <Text fontSize="xs" color="red.400">No webhook-capable pieces registered</Text>
            ) : (
              <InlineSelect
                value={pieceName}
                onChange={setPieceName}
                options={webhookPieces.map((p) => ({ value: p.name, label: p.displayName }))}
              />
            )}
          </Box>
          <Box flex={1} minW="160px">
            <Text fontSize="2xs" color="gray.500" mb={1} fontWeight="medium">Trigger *</Text>
            <InlineSelect
              value={triggerName}
              onChange={setTriggerName}
              options={webhookTriggers.map((t) => ({ value: t.name, label: t.displayName }))}
              placeholder={webhookTriggers.length === 0 ? 'No webhook triggers' : undefined}
            />
          </Box>
        </Flex>

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
              />
            </Box>
          </Flex>
        </Box>

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

        {error && <Text fontSize="xs" color="red.500">{error}</Text>}

        <HStack gap={2} justify="flex-end">
          <Button size="sm" variant="ghost" colorPalette="gray" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            colorPalette="blue"
            onClick={handleSubmit}
            loading={saving}
            disabled={!pieceName || !triggerName || !deliveryValue.trim()}
          >
            Create Subscription
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TriggersPanel — main export
// ---------------------------------------------------------------------------

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
