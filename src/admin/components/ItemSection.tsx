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
import type { PieceAction, PieceTrigger, PropDef } from '../lib/api';

import { ActionUsageTab, baseUrl, ItemMcpTab, PropTable, TriggerUsageTab } from './ItemUsage';

// --------------------------------------------------------------------------
// Single action / trigger row with expand/collapse
// --------------------------------------------------------------------------

interface ItemRowProps {
  pieceName: string;
  name: string;
  displayName: string;
  description: string | null;
  props: Record<string, PropDef> | null;
  accentColor: string;
  badge?: string;
  badgePalette?: string;
  kind: 'action' | 'trigger';
  /** Trigger strategy, e.g. 'POLLING', 'APP_WEBHOOK', 'WEBHOOK'. Only set when kind='trigger'. */
  triggerType?: string;
}

function ItemRow({
  pieceName,
  name,
  displayName,
  description,
  props,
  accentColor,
  badge,
  badgePalette = 'gray',
  kind,
  triggerType,
}: ItemRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const hasParams = props && Object.keys(props).length > 0;
  const paramCount = hasParams ? Object.keys(props).length : 0;

  return (
    <>
      <Flex
        as="button"
        w="full"
        align="center"
        gap={2}
        px={3}
        py={2}
        bg="white"
        borderWidth="1px"
        borderColor="gray.100"
        rounded="md"
        cursor="pointer"
        _hover={{ bg: 'gray.50', borderColor: 'gray.200' }}
        onClick={() => setDialogOpen(true)}
        textAlign="left"
      >
        {/* Dot */}
        <Box w={1.5} h={1.5} bg={accentColor} rounded="full" flexShrink={0} />

        {/* Labels */}
        <Box flex={1} minW={0}>
          <HStack gap={2} flexWrap="wrap">
            <Text fontSize="xs" fontWeight="medium" color="gray.800">
              {displayName}
            </Text>
            <Text fontSize="xs" color="gray.400" fontFamily="mono">
              {name}
            </Text>
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

        <Box color="gray.300" flexShrink={0}>
          <ScanSearch size={13} />
        </Box>
      </Flex>

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
                  <Tabs.Trigger value="mcp">MCP</Tabs.Trigger>
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
                <Tabs.Content value="mcp">
                  <ItemMcpTab pieceName={pieceName} />
                </Tabs.Content>
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
  icon?: LucideIcon;
  pieceName: string;
  badgeKey?: string;
  badgePalette?: string;
  items: Array<PieceAction | PieceTrigger>;
  kind: 'action' | 'trigger';
}

function CollapsibleSection({
  title,
  count,
  accentColor,
  icon: Icon,
  pieceName,
  badgeKey,
  badgePalette,
  items,
  kind,
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
              pieceName={pieceName}
              name={item.name}
              displayName={item.displayName}
              description={item.description}
              props={item.props}
              accentColor={accentColor}
              badge={badgeKey ? String((item as unknown as Record<string, unknown>)[badgeKey] ?? '') : undefined}
              badgePalette={badgePalette}
              kind={kind}
              triggerType={kind === 'trigger' ? (item as PieceTrigger).type : undefined}
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
