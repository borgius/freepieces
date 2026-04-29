import {
  Badge,
  Box,
  ClipboardRoot,
  ClipboardTrigger,
  HStack,
  Table,
  Text,
  VStack,
} from '@chakra-ui/react';
import { Copy, Link2 } from 'lucide-react';
import type { PropDef } from '../lib/api';

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
export function baseUrl(): string {
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
    `  -H "Authorization: Bearer $FREEPIECES_RUN_API_KEY" \\`,
    `  -H "X-User-Id: $FREEPIECES_USER_ID" \\`,
    `  -H "X-Piece-Token: $FREEPIECES_PIECE_TOKEN" \\`,
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
    `    Authorization: 'Bearer ' + process.env.FREEPIECES_RUN_API_KEY,`,
    `    'X-User-Id': process.env.FREEPIECES_USER_ID ?? '',`,
    `    'X-Piece-Token': process.env.FREEPIECES_PIECE_TOKEN ?? '',`,
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

export function CodeBlock({ label, code }: { label: string; code: string }) {
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
    `  -H "Authorization: Bearer $FREEPIECES_RUN_API_KEY" \\`,
    `  -H "X-User-Id: $FREEPIECES_USER_ID" \\`,
    `  -H "X-Piece-Token: $FREEPIECES_PIECE_TOKEN" \\`,
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
    `  -H "Authorization: Bearer $FREEPIECES_RUN_API_KEY" \\`,
    `  -H "X-User-Id: $FREEPIECES_USER_ID" \\`,
    `  -H "X-Piece-Token: $FREEPIECES_PIECE_TOKEN" \\`,
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
    `    Authorization: 'Bearer ' + process.env.FREEPIECES_RUN_API_KEY,`,
    `    'X-User-Id': process.env.FREEPIECES_USER_ID ?? '',`,
    `    'X-Piece-Token': process.env.FREEPIECES_PIECE_TOKEN ?? '',`,
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
    `  -H "Authorization: Bearer $FREEPIECES_RUN_API_KEY" \\`,
    `  -H "X-User-Id: $FREEPIECES_USER_ID" \\`,
    `  -H "X-Piece-Token: $FREEPIECES_PIECE_TOKEN" \\`,
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

export function ActionUsageTab({
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

export function TriggerUsageTab({
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

export function PropTable({ props }: { props: Record<string, PropDef> }) {
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
