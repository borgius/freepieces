import { useState } from 'react';
import {
  Badge,
  Box,
  ClipboardRoot,
  ClipboardTrigger,
  DialogBackdrop,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogPositioner,
  DialogRoot,
  DialogTitle,
  Flex,
  HStack,
  Tabs,
  Text,
  VStack
} from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Copy, Link2, ScanSearch } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { setPieceItemEnabled, type PieceAction, type PieceTrigger, type PropDef, type PieceAuth } from '../lib/api';

import { ActionUsageTab, baseUrl, ItemMcpTab, PropTable, TriggerUsageTab } from './ItemUsage';
import { ActionTryItTab } from './ItemTryIt';

// --------------------------------------------------------------------------
// Single action / trigger row with expand/collapse
// --------------------------------------------------------------------------

interface ItemRowProps {
  currentUserId: string;
  pieceName: string;
  name: string;
  displayName: string;
  description: string | null;
  props: Record<string, PropDef> | null;
  accentColor: string;
  enabled: boolean;
  badge?: string;
  badgePalette?: string;
  kind: 'action' | 'trigger';
  /** Trigger strategy, e.g. 'POLLING', 'APP_WEBHOOK', 'WEBHOOK'. Only set when kind='trigger'. */
  triggerType?: string;
  pieceAuth?: PieceAuth;
  pieceSupportsUsers?: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

function ItemRow({
  currentUserId,
  pieceName,
  name,
  displayName,
  description,
  props,
  accentColor,
  enabled,
  badge,
  badgePalette = 'gray',
  kind,
  triggerType,
  pieceAuth,
  pieceSupportsUsers,
  onEnabledChange,
}: ItemRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const hasParams = props && Object.keys(props).length > 0;
  const paramCount = hasParams ? Object.keys(props).length : 0;
  const indicatorColor = enabled ? accentColor : 'gray.300';

  async function handleEnabledToggle(nextEnabled: boolean) {
    setToggleLoading(true);
    setToggleError('');

    try {
      await setPieceItemEnabled(pieceName, kind, name, nextEnabled, currentUserId || undefined);
      onEnabledChange(nextEnabled);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : `Failed to update ${kind}`);
    } finally {
      setToggleLoading(false);
    }
  }

  return (
    <>
      <Box
        bg="white"
        borderWidth="1px"
        borderColor="gray.100"
        rounded="md"
        _hover={{ bg: 'gray.50', borderColor: 'gray.200' }}
      >
        <Flex align="center" gap={2} px={3} py={2}>
          <Flex
            as="button"
            flex={1}
            minW={0}
            align="center"
            gap={2}
            textAlign="left"
            onClick={() => setDialogOpen(true)}
          >
            <Box w={1.5} h={1.5} bg={indicatorColor} rounded="full" flexShrink={0} />

            <Box flex={1} minW={0}>
              <HStack gap={2} flexWrap="wrap">
                <Text fontSize="xs" fontWeight="medium" color="gray.800">
                  {displayName}
                </Text>
                <Text fontSize="xs" color="gray.400" fontFamily="mono">
                  {name}
                </Text>
                {!enabled && (
                  <Badge colorPalette="gray" variant="subtle" fontSize="2xs">
                    Disabled
                  </Badge>
                )}
                {badge && (
                  <Badge colorPalette={badgePalette} variant="outline" fontSize="2xs">
                    {badge}
                  </Badge>
                )}
                {hasParams && (
                  <Badge colorPalette="gray" variant="subtle" fontSize="2xs">
                    {paramCount} params
                  </Badge>
                )}
              </HStack>
              {description && (
                <Text fontSize="xs" color="gray.500" mt={0.5} lineClamp={1}>
                  {description}
                </Text>
              )}
            </Box>
          </Flex>

          <HStack gap={2} flexShrink={0}>
            <Box
              as="button"
              color="gray.300"
              _hover={{ color: 'gray.500' }}
              onClick={() => setDialogOpen(true)}
              aria-label={`Open ${kind} details for ${displayName}`}
              title="Open details"
            >
              <ScanSearch size={13} />
            </Box>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: toggleLoading ? 'wait' : 'pointer',
                opacity: toggleLoading ? 0.7 : 1,
              }}
              title={enabled ? `Disable ${displayName}` : `Enable ${displayName}`}
            >
              <input
                aria-label={`Enable ${kind} ${displayName}`}
                checked={enabled}
                disabled={toggleLoading}
                type="checkbox"
                onChange={(event) => void handleEnabledToggle(event.target.checked)}
              />
              <Text fontSize="2xs" color="gray.500">
                On
              </Text>
            </label>
          </HStack>
        </Flex>

        {toggleError && (
          <Text color="red.500" fontSize="2xs" px={3} pb={2}>
            {toggleError}
          </Text>
        )}
      </Box>

      <DialogRoot
        open={dialogOpen}
        onOpenChange={(e) => setDialogOpen(e.open)}
        scrollBehavior="inside"
      >
        <DialogBackdrop />
        <DialogPositioner>
          <DialogContent maxW="2xl" w="90vw" maxH="80vh" rounded="xl">
            <DialogHeader pb={0} borderBottomWidth="1px" borderColor="gray.100">
              <HStack gap={3} align="baseline" flexWrap="wrap">
                <DialogTitle fontSize="md">{displayName}</DialogTitle>
                <Text fontSize="xs" color="gray.400" fontFamily="mono">{name}</Text>
              </HStack>
              {description && (
                <Text fontSize="xs" color="gray.500" mt={1}>
                  {description}
                </Text>
              )}
            </DialogHeader>
            <DialogCloseTrigger />
            <DialogBody pb={6} pt={0}>
              <Tabs.Root defaultValue="params" size="sm">
                <Tabs.List borderBottomWidth="1px" borderColor="gray.100" mb={3}>
                  <Tabs.Trigger value="params">Params {hasParams ? `(${paramCount})` : ''}</Tabs.Trigger>
                  <Tabs.Trigger value="usage">Usage</Tabs.Trigger>
                  {kind === 'action' && (
                    <Tabs.Trigger value="mcp">MCP</Tabs.Trigger>
                  )}
                  {kind === 'action' && (
                    <Tabs.Trigger value="tryit">Try it</Tabs.Trigger>
                  )}
                </Tabs.List>
                <Tabs.Content value="params">
                  {hasParams
                    ? <PropTable props={props} />
                    : <Text fontSize="xs" color="gray.400">No parameters defined.</Text>
                  }
                </Tabs.Content>
                <Tabs.Content value="usage">
                  {kind === 'trigger'
                    ? <TriggerUsageTab pieceName={pieceName} triggerName={name} triggerType={triggerType ?? 'POLLING'} props={props} />
                    : <ActionUsageTab pieceName={pieceName} actionName={name} props={props} />
                  }
                </Tabs.Content>
                {kind === 'action' && (
                  <Tabs.Content value="mcp">
                    <ItemMcpTab pieceName={pieceName} />
                  </Tabs.Content>
                )}
                {kind === 'action' && (
                  <Tabs.Content value="tryit">
                    <ActionTryItTab
                      pieceName={pieceName}
                      actionName={name}
                      props={props}
                      pieceAuth={pieceAuth}
                      pieceSupportsUsers={pieceSupportsUsers ?? false}
                    />
                  </Tabs.Content>
                )}
              </Tabs.Root>
            </DialogBody>
          </DialogContent>
        </DialogPositioner>
      </DialogRoot>
    </>
  );
}

// --------------------------------------------------------------------------
// CollapsibleSection — foldable "Actions" / "Triggers" section
// --------------------------------------------------------------------------

interface SectionProps {
  title: string;
  count: number;
  accentColor: string;
  currentUserId: string;
  icon?: LucideIcon;
  pieceName: string;
  badgeKey?: string;
  badgePalette?: string;
  items: Array<PieceAction | PieceTrigger>;
  kind: 'action' | 'trigger';
  onItemEnabledChange: (kind: 'action' | 'trigger', itemName: string, enabled: boolean) => void;
  pieceAuth?: PieceAuth;
  pieceSupportsUsers?: boolean;
}

function CollapsibleSection({
  title,
  count,
  accentColor,
  currentUserId,
  icon: Icon,
  pieceName,
  badgeKey,
  badgePalette,
  items,
  kind,
  onItemEnabledChange,
  pieceAuth,
  pieceSupportsUsers,
}: SectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Box mt={3}>
      {/* Section header */}
      <Flex
        as="button"
        align="center"
        gap={1.5}
        w="full"
        textAlign="left"
        cursor="pointer"
        _hover={{ color: 'gray.700' }}
        color="gray.500"
        onClick={() => setOpen((s) => !s)}
        mb={open ? 2 : 0}
      >
        <Box flexShrink={0}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Box>
        {Icon && (
          <Box flexShrink={0} color={accentColor}>
            <Icon size={12} />
          </Box>
        )}
        <Text
          fontSize="xs"
          fontWeight="semibold"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          {title}
        </Text>
        <Badge colorPalette="gray" variant="subtle" fontSize="2xs" ml={1}>
          {count}
        </Badge>
      </Flex>

      {open && (
        <VStack align="stretch" gap={1}>
          {/* Webhook URL for non-POLLING trigger sections */}
          {kind === 'trigger' && items.some((t) => (t as PieceTrigger).type !== 'POLLING') && (
            <Box
              bg="purple.50"
              borderWidth="1px"
              borderColor="purple.200"
              rounded="md"
              px={3}
              py={2}
              mb={1}
            >
              <HStack gap={1.5} mb={1}>
                <Link2 size={12} color="var(--chakra-colors-purple-500)" />
                <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                  Provider Webhook URL
                </Text>
              </HStack>
              <HStack gap={2}>
                <Box flex={1} fontFamily="mono" fontSize="xs" color="purple.700" wordBreak="break-all">
                  {`${baseUrl()}/webhook/${pieceName}`}
                </Box>
                <ClipboardRoot value={`${baseUrl()}/webhook/${pieceName}`} timeout={1500}>
                  <ClipboardTrigger asChild>
                    <Box as="button" color="gray.400" _hover={{ color: 'purple.500' }} flexShrink={0} title="Copy webhook URL">
                      <Copy size={12} />
                    </Box>
                  </ClipboardTrigger>
                </ClipboardRoot>
              </HStack>
              <Text fontSize="xs" color="gray.400" mt={1}>
                Set this as the Request URL in your provider’s webhook settings.
              </Text>
            </Box>
          )}
          {items.map((item) => (
            <ItemRow
              key={item.name}
              currentUserId={currentUserId}
              pieceName={pieceName}
              name={item.name}
              displayName={item.displayName}
              description={item.description}
              props={item.props}
              accentColor={accentColor}
              enabled={item.enabled}
              badge={badgeKey ? String((item as unknown as Record<string, unknown>)[badgeKey] ?? '') : undefined}
              badgePalette={badgePalette}
              kind={kind}
              onEnabledChange={(enabled) => onItemEnabledChange(kind, item.name, enabled)}
              triggerType={kind === 'trigger' ? (item as PieceTrigger).type : undefined}
              pieceAuth={pieceAuth}
              pieceSupportsUsers={pieceSupportsUsers}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}

// --------------------------------------------------------------------------
// Public exports
// --------------------------------------------------------------------------

export { CollapsibleSection };
