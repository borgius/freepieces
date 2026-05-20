import { useState } from 'react';
import {
  Badge,
  Box,
  Code,
  Flex,
  HStack,
  Spinner,
  Text,
  VStack,
  ClipboardRoot,
  ClipboardTrigger,
} from '@chakra-ui/react';
import { Check, ChevronDown, ChevronRight, Copy, Pencil, Trash2, X } from 'lucide-react';
import { type TriggerGroup, deleteAdminSubscription, updateAdminSubscription } from '../lib/api';
import { InlineInput } from './TriggerInlineControls';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function endpointTypeLabel(type: string): string {
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

export function TriggerGroupRow({
  group,
  onRefresh,
  isExpanded,
  onToggle,
}: {
  group: TriggerGroup;
  onRefresh: () => void;
  isExpanded: boolean;
  onToggle: (open: boolean) => void;
}) {
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
          onClick={() => onToggle(!isExpanded)}
          cursor="pointer"
          _hover={{ color: 'gray.600' }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Box>

        <Box
          flex={1}
          minW={0}
          onClick={() => !editing && onToggle(!isExpanded)}
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

      {isExpanded && (
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
