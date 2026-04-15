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
  Table,
  Tabs,
  Text,
  VStack
} from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Copy, Link2, ScanSearch } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PieceAction, PieceTrigger, PropDef } from '../lib/api';

// --------------------------------------------------------------------------
// Prop type → color
// --------------------------------------------------------------------------

const PROP_TYPE_PALETTE: Record<string, string> = {
  SHORT_TEXT: 'blue',
  LONG_TEXT: 'blue',
  NUMBER: 'cyan',
  CHECKBOX: 'teal',
  SELECT: 'purple',
  MULTI_SELECT: 'purple',
  STATIC_SELECT: 'purple',
  STATIC_MULTI_SELECT: 'purple',
  OAUTH_DYNAMIC_SELECT: 'orange',
  DYNAMIC: 'yellow',
  OBJECT: 'gray',
  JSON: 'gray',
  ARRAY: 'gray',
  FILE: 'pink',
  DATE_TIME: 'red',
};

function propPalette(type: string): string {
  return PROP_TYPE_PALETTE[type] ?? 'gray';
}

// --------------------------------------------------------------------------
// Code-generation helpers
// --------------------------------------------------------------------------

/** Worker base URL derived from the admin panel's origin (same Worker). */
function baseUrl(): string {
  return window.location.origin;
}

function toEnvKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function buildCurlSnippet(
  pieceName: string,
  actionName: string,
  props: Record<string, PropDef> | null,
): string {
  const entries = props ? Object.entries(props) : [];
  let dataArg: string;
  if (entries.length === 0) {
    dataArg = "'{}'";
  } else {
    const lines = entries.map(([key], i) => {
      const envKey = toEnvKey(key);
      const comma = i < entries.length - 1 ? ',' : '';
      // Shell: close single-quote, open double-quote for env-var, reopen single-quote
      return `    "${key}": '"$${envKey}"'${comma}`;
    });
    dataArg = `'{\n${lines.join('\n')}\n  }'`;
  }
  return [
    `curl "${baseUrl()}/run/${pieceName}/${actionName}" \\`,
    `  -X POST \\`,
    `  -H "Authorization: Bearer $FREEPIECES_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d ${dataArg}`,
  ].join('\n');
}

function buildFetchSnippet(
  pieceName: string,
  actionName: string,
  props: Record<string, PropDef> | null,
): string {
  const entries = props ? Object.entries(props) : [];
  const bodyLines = entries.map(([key]) => {
    const envKey = toEnvKey(key);
    return `    ${key}: process.env.${envKey},`;
  });
  const bodyObj =
    entries.length > 0
      ? `JSON.stringify({\n${bodyLines.join('\n')}\n  })`
      : 'JSON.stringify({})';
  return [
    `const res = await fetch('${baseUrl()}/run/${pieceName}/${actionName}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    '    Authorization: `Bearer ${process.env.FREEPIECES_TOKEN}`,',
    `    'Content-Type': 'application/json',`,
    `  },`,
    `  body: ${bodyObj},`,
    `});`,
    `const data = await res.json();`,
  ].join('\n');
}

// --------------------------------------------------------------------------
// CodeBlock — pre/code with copy button
// --------------------------------------------------------------------------

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <Box>
      <HStack justify="space-between" align="center" mb={1}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
          {label}
        </Text>
        <ClipboardRoot value={code} timeout={1500}>
          <ClipboardTrigger asChild>
            <Box as="button" color="gray.400" _hover={{ color: 'blue.500' }} title="Copy">
              <Copy size={13} />
            </Box>
          </ClipboardTrigger>
        </ClipboardRoot>
      </HStack>
      <Box
        as="pre"
        fontFamily="mono"
        fontSize="xs"
        bg="gray.900"
        color="gray.100"
        rounded="md"
        p={3}
        overflow="auto"
        whiteSpace="pre"
        lineHeight={1.6}
      >
        {code}
      </Box>
    </Box>
  );
}

// --------------------------------------------------------------------------
// Trigger-specific code snippets
// --------------------------------------------------------------------------

function buildTriggerPollCurlSnippet(
  pieceName: string,
  triggerName: string,
  props: Record<string, PropDef> | null,
): string {
  const entries = props ? Object.entries(props) : [];
  let propsObj: string;
  if (entries.length === 0) {
    propsObj = '{}';
  } else {
    const lines = entries.map(([key], i) => {
      const envKey = toEnvKey(key);
      const comma = i < entries.length - 1 ? ',' : '';
      return `      "${key}": '"$${envKey}"'${comma}`;
    });
    propsObj = `{\n${lines.join('\n')}\n    }`;
  }
  return [
    `curl "${baseUrl()}/trigger/${pieceName}/${triggerName}" \\`,
    `  -X POST \\`,
    `  -H "Authorization: Bearer $FREEPIECES_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "propsValue": ${propsObj},`,
    `    "lastPollMs": 0`,
    `  }'`,
  ].join('\n');
}

function buildSubscribeCurlSnippet(
  pieceName: string,
  triggerName: string,
  props: Record<string, PropDef> | null,
): string {
  const entries = props ? Object.entries(props) : [];
  let propsObj: string;
  if (entries.length === 0) {
    propsObj = '{}';
  } else {
    const lines = entries.map(([key], i) => {
      const envKey = toEnvKey(key);
      const comma = i < entries.length - 1 ? ',' : '';
      return `      "${key}": '"$${envKey}"'${comma}`;
    });
    propsObj = `{\n${lines.join('\n')}\n    }`;
  }
  return [
    `# 1. Register your callback URL to receive events`,
    `curl "${baseUrl()}/subscriptions/${pieceName}/${triggerName}" \\`,
    `  -X POST \\`,
    `  -H "Authorization: Bearer $FREEPIECES_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "callbackUrl": "https://your-server.com/webhook",`,
    `    "propsValue": ${propsObj}`,
    `  }'`,
  ].join('\n');
}

function buildSubscribeFetchSnippet(
  pieceName: string,
  triggerName: string,
  props: Record<string, PropDef> | null,
): string {
  const entries = props ? Object.entries(props) : [];
  const bodyLines = entries.map(([key]) => {
    const envKey = toEnvKey(key);
    return `      ${key}: process.env.${envKey},`;
  });
  const propsObj =
    entries.length > 0
      ? `{\n${bodyLines.join('\n')}\n    }`
      : '{}';
  return [
    `// 1. Register your callback URL to receive events`,
    `const res = await fetch('${baseUrl()}/subscriptions/${pieceName}/${triggerName}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    '    Authorization: `Bearer ${process.env.FREEPIECES_TOKEN}`,',
    `    'Content-Type': 'application/json',`,
    `  },`,
    `  body: JSON.stringify({`,
    `    callbackUrl: 'https://your-server.com/webhook',`,
    `    propsValue: ${propsObj},`,
    `  }),`,
    `});`,
    `const { id, webhookUrl } = await res.json();`,
    `// webhookUrl → give this to the provider (e.g. Slack Event Subscriptions)`,
  ].join('\n');
}

function buildSubscribeQueueCurlSnippet(
  pieceName: string,
  triggerName: string,
  props: Record<string, PropDef> | null,
): string {
  const entries = props ? Object.entries(props) : [];
  let propsObj: string;
  if (entries.length === 0) {
    propsObj = '{}';
  } else {
    const lines = entries.map(([key], i) => {
      const envKey = toEnvKey(key);
      const comma = i < entries.length - 1 ? ',' : '';
      return `      "${key}": '"$${envKey}"'${comma}`;
    });
    propsObj = `{\n${lines.join('\n')}\n    }`;
  }
  return [
    `# Subscribe with a Cloudflare Queue as delivery target`,
    `# Requires [[queues.producers]] binding in wrangler.toml`,
    `curl "${baseUrl()}/subscriptions/${pieceName}/${triggerName}" \\`,
    `  -X POST \\`,
    `  -H "Authorization: Bearer $FREEPIECES_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "queueName": "your-queue-name",`,
    `    "propsValue": ${propsObj}`,
    `  }'`,
  ].join('\n');
}

function buildDeliveryPayloadExample(
  pieceName: string,
  triggerName: string,
): string {
  return JSON.stringify(
    {
      piece: pieceName,
      trigger: triggerName,
      events: [
        { '...': 'event data from the provider' },
      ],
    },
    null,
    2,
  );
}

// --------------------------------------------------------------------------
// Usage tabs
// --------------------------------------------------------------------------

function ActionUsageTab({
  pieceName,
  actionName,
  props,
}: {
  pieceName: string;
  actionName: string;
  props: Record<string, PropDef> | null;
}) {
  const curl = buildCurlSnippet(pieceName, actionName, props);
  const fetchCode = buildFetchSnippet(pieceName, actionName, props);
  return (
    <VStack align="stretch" gap={4}>
      <CodeBlock label="curl" code={curl} />
      <CodeBlock label="JavaScript (fetch)" code={fetchCode} />
    </VStack>
  );
}

function TriggerUsageTab({
  pieceName,
  triggerName,
  triggerType,
  props,
}: {
  pieceName: string;
  triggerName: string;
  triggerType: string;
  props: Record<string, PropDef> | null;
}) {
  const isPolling = triggerType === 'POLLING';
  const webhookUrl = `${baseUrl()}/webhook/${pieceName}`;

  return (
    <VStack align="stretch" gap={5}>
      {/* Webhook URL — for APP_WEBHOOK / WEBHOOK triggers */}
      {!isPolling && (
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1}>
            Provider Webhook URL
          </Text>
          <Text fontSize="xs" color="gray.600" mb={2}>
            Give this URL to the provider (e.g. Slack Event Subscriptions → Request URL).
            Incoming events are forwarded to all registered subscriptions.
          </Text>
          <HStack
            bg="purple.50"
            borderWidth="1px"
            borderColor="purple.200"
            rounded="md"
            px={3}
            py={2}
            gap={2}
          >
            <Link2 size={13} color="var(--chakra-colors-purple-500)" />
            <Box
              flex={1}
              fontFamily="mono"
              fontSize="xs"
              color="purple.700"
              wordBreak="break-all"
            >
              {webhookUrl}
            </Box>
            <ClipboardRoot value={webhookUrl} timeout={1500}>
              <ClipboardTrigger asChild>
                <Box as="button" color="gray.400" _hover={{ color: 'purple.500' }} flexShrink={0} title="Copy">
                  <Copy size={13} />
                </Box>
              </ClipboardTrigger>
            </ClipboardRoot>
          </HStack>
        </Box>
      )}

      {/* Subscribe — for APP_WEBHOOK / WEBHOOK triggers */}
      {!isPolling && (
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1}>
            Subscribe to events
          </Text>
          <Text fontSize="xs" color="gray.600" mb={2}>
            Register your HTTPS callback URL so matched events are POSTed to your server,
            or use a Cloudflare Queue as the delivery target.
          </Text>
          <VStack align="stretch" gap={4}>
            <CodeBlock label="curl (callback URL)" code={buildSubscribeCurlSnippet(pieceName, triggerName, props)} />
            <CodeBlock label="JavaScript (fetch)" code={buildSubscribeFetchSnippet(pieceName, triggerName, props)} />
            <CodeBlock label="curl (Cloudflare Queue)" code={buildSubscribeQueueCurlSnippet(pieceName, triggerName, props)} />
          </VStack>
        </Box>
      )}

      {/* Poll — for POLLING triggers */}
      {isPolling && (
        <Box>
          <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1}>
            Poll for new events
          </Text>
          <Text fontSize="xs" color="gray.600" mb={2}>
            Call this endpoint on a schedule (e.g. every minute). Pass <code>lastPollMs</code> from your
            previous run so only new events are returned. Use <code>0</code> for the first run.
          </Text>
          <VStack align="stretch" gap={4}>
            <CodeBlock label="curl" code={buildTriggerPollCurlSnippet(pieceName, triggerName, props)} />
          </VStack>
        </Box>
      )}

      {/* Expected delivery payload */}
      <Box>
        <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1}>
          {isPolling ? 'Response format' : 'Delivery payload'}
        </Text>
        <Text fontSize="xs" color="gray.600" mb={2}>
          {isPolling
            ? 'The response contains an events array with matched items.'
            : 'When events match, this JSON is POSTed to your callbackUrl (or sent to your Cloudflare Queue).'}
        </Text>
        <CodeBlock label="JSON" code={buildDeliveryPayloadExample(pieceName, triggerName)} />
      </Box>
    </VStack>
  );
}

// --------------------------------------------------------------------------
// PropTable — shows structured params
// --------------------------------------------------------------------------

function PropTable({ props }: { props: Record<string, PropDef> }) {
  const entries = Object.entries(props);
  if (entries.length === 0) return null;

  return (
    <Box mt={2} borderWidth="1px" borderColor="gray.100" rounded="md" overflow="hidden" w="full">
      <Table.Root size="sm" w="full">
        <Table.Header>
          <Table.Row bg="gray.50">
            <Table.ColumnHeader fontSize="xs" fontWeight="semibold" color="gray.500" py={1.5} px={3} w="35%">
              Param
            </Table.ColumnHeader>
            <Table.ColumnHeader fontSize="xs" fontWeight="semibold" color="gray.500" py={1.5} px={3} w="20%">
              Type
            </Table.ColumnHeader>
            <Table.ColumnHeader fontSize="xs" fontWeight="semibold" color="gray.500" py={1.5} px={3} w="10%">
              Req
            </Table.ColumnHeader>
            <Table.ColumnHeader fontSize="xs" fontWeight="semibold" color="gray.500" py={1.5} px={3}>
              Description
            </Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {entries.map(([key, def]) => (
            <Table.Row key={key}>
              <Table.Cell py={1.5} px={3}>
                <VStack align="start" gap={0}>
                  <Text fontSize="xs" fontWeight="medium" color="gray.800">
                    {def.displayName}
                  </Text>
                  <Text fontSize="xs" color="gray.400" fontFamily="mono">
                    {key}
                  </Text>
                </VStack>
              </Table.Cell>
              <Table.Cell py={1.5} px={3}>
                <Badge
                  colorPalette={propPalette(def.type)}
                  variant="subtle"
                  fontSize="2xs"
                  textTransform="none"
                >
                  {def.type}
                </Badge>
              </Table.Cell>
              <Table.Cell py={1.5} px={3}>
                {def.required ? (
                  <Badge colorPalette="red" variant="subtle" fontSize="2xs">yes</Badge>
                ) : (
                  <Text fontSize="xs" color="gray.400">—</Text>
                )}
              </Table.Cell>
              <Table.Cell py={1.5} px={3}>
                <Text fontSize="xs" color="gray.500">
                  {def.description ?? ''}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

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
