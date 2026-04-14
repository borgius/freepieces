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
import { ChevronDown, ChevronRight, Copy, ScanSearch } from 'lucide-react';
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
    `curl "$FREEPIECES_URL/run/${pieceName}/${actionName}" \\`,
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
    `const res = await fetch(\`\${process.env.FREEPIECES_URL}/run/${pieceName}/${actionName}\`, {`,
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

function UsageTab({
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
                  <UsageTab pieceName={pieceName} actionName={name} props={props} />
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
