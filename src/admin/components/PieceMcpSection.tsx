import { useState } from 'react';
import {
  Badge,
  Box,
  ClipboardRoot,
  ClipboardTrigger,
  Flex,
  HStack,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Copy, Webhook } from 'lucide-react';
import type { PieceInfo } from '../lib/api';
import { CodeBlock } from './ItemUsage';

function mcpEndpoint(piece: PieceInfo): string {
  return `${window.location.origin}${piece.mcpEndpoint}`;
}

function mcpConfigSnippet(piece: PieceInfo): string {
  return JSON.stringify(
    {
      mcpServers: {
        [piece.name]: {
          url: mcpEndpoint(piece),
          headers: {
            Authorization: 'Bearer ${FREEPIECES_RUN_API_KEY}',
            'X-User-Id': '${FREEPIECES_USER_ID}',
            'X-Piece-Token': '${FREEPIECES_PIECE_TOKEN}',
          },
        },
      },
    },
    null,
    2,
  );
}

function mcpCurlSnippet(piece: PieceInfo): string {
  return [
    `curl "${mcpEndpoint(piece)}" \\`,
    `  -X POST \\`,
    `  -H "Authorization: Bearer $FREEPIECES_RUN_API_KEY" \\`,
    `  -H "X-User-Id: $FREEPIECES_USER_ID" \\`,
    `  -H "X-Piece-Token: $FREEPIECES_PIECE_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "jsonrpc": "2.0",`,
    `    "id": 1,`,
    `    "method": "tools/list"`,
    `  }'`,
  ].join('\n');
}

export function McpSection({ piece }: { piece: PieceInfo }) {
  const [open, setOpen] = useState(false);
  const endpoint = mcpEndpoint(piece);

  return (
    <Box mt={3}>
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
        <Box flexShrink={0} color="blue.400">
          <Webhook size={12} />
        </Box>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
          MCP
        </Text>
        <Badge colorPalette="blue" variant="subtle" fontSize="2xs" ml={1}>
          {piece.actions.length} tools
        </Badge>
      </Flex>

      {open && (
        <VStack align="stretch" gap={3}>
          <Box
            bg="blue.50"
            borderWidth="1px"
            borderColor="blue.200"
            rounded="md"
            px={3}
            py={2}
          >
            <HStack gap={2}>
              <Box flex={1} fontFamily="mono" fontSize="xs" color="blue.700" wordBreak="break-all">
                {endpoint}
              </Box>
              <ClipboardRoot value={endpoint} timeout={1500}>
                <ClipboardTrigger asChild>
                  <Box as="button" color="gray.400" _hover={{ color: 'blue.500' }} flexShrink={0} title="Copy MCP endpoint">
                    <Copy size={12} />
                  </Box>
                </ClipboardTrigger>
              </ClipboardRoot>
            </HStack>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Use the same runtime token and piece credential headers as action, trigger, and subscription calls.
            </Text>
          </Box>
          <CodeBlock label="MCP client config" code={mcpConfigSnippet(piece)} />
          <CodeBlock label="List MCP tools" code={mcpCurlSnippet(piece)} />
        </VStack>
      )}
    </Box>
  );
}
