import {
  Badge,
  Box,
  ClipboardRoot,
  ClipboardTrigger,
  Code,
  Container,
  Flex,
  HStack,
  Heading,
  Text,
  VStack,
} from '@chakra-ui/react';
import { Copy } from 'lucide-react';

// ---------------------------------------------------------------------------
// Reusable helpers
// ---------------------------------------------------------------------------

function CopyableCode({ children }: { children: string }) {
  return (
    <HStack gap={1.5} align="center" flexWrap="nowrap">
      <Code
        fontSize="sm"
        colorPalette="blue"
        variant="surface"
        px={2}
        py={1}
        fontFamily="mono"
        whiteSpace="pre"
      >
        {children}
      </Code>
      <ClipboardRoot value={children} timeout={1500}>
        <ClipboardTrigger asChild>
          <Box
            as="button"
            color="gray.400"
            _hover={{ color: 'blue.500' }}
            flexShrink={0}
            title="Copy"
          >
            <Copy size={13} />
          </Box>
        </ClipboardTrigger>
      </ClipboardRoot>
    </HStack>
  );
}

interface StepProps {
  number: number;
  title: string;
  children: React.ReactNode;
}

function Step({ number, title, children }: StepProps) {
  return (
    <Flex gap={4} align="flex-start">
      <Box
        w={7}
        h={7}
        rounded="full"
        bg="blue.500"
        color="white"
        fontSize="xs"
        fontWeight="bold"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
        mt={0.5}
      >
        {number}
      </Box>
      <Box flex={1}>
        <Text fontWeight="semibold" fontSize="sm" color="gray.800" mb={1.5}>
          {title}
        </Text>
        {children}
      </Box>
    </Flex>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading size="sm" color="gray.700" mb={3} mt={2}>
      {children}
    </Heading>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Box
      bg="blue.50"
      borderLeftWidth="3px"
      borderColor="blue.300"
      px={3}
      py={2}
      rounded="md"
      mt={2}
    >
      <Text fontSize="xs" color="blue.700">{children}</Text>
    </Box>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <Box
      bg="orange.50"
      borderLeftWidth="3px"
      borderColor="orange.300"
      px={3}
      py={2}
      rounded="md"
      mt={2}
    >
      <Text fontSize="xs" color="orange.800">{children}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AddPiecePage() {
  return (
    <Container maxW="3xl" py={8}>
      <Box mb={8}>
        <Heading size="lg" mb={1}>Add a Piece</Heading>
        <Text fontSize="sm" color="gray.500">
          Use the <Code fontSize="sm" fontFamily="mono">fp</Code> CLI to discover, install,
          configure secrets, and deploy new integrations.
        </Text>
      </Box>

      {/* ── Install CLI ─────────────────────────────────────────────────── */}
      <Box mb={10}>
        <SectionHeading>1 · Install the CLI</SectionHeading>
        <VStack align="stretch" gap={4}>
          <Step number={1} title="Install fp globally">
            <CopyableCode>npm install -g freepieces</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Or use it without installing via{' '}
              <Code fontSize="xs" fontFamily="mono">npx fp</Code>.
            </Text>
          </Step>

          <Step number={2} title="Verify wrangler is authenticated">
            <CopyableCode>wrangler whoami</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              If not logged in, run{' '}
              <Code fontSize="xs" fontFamily="mono">wrangler login</Code> first.
            </Text>
          </Step>
        </VStack>
      </Box>

      {/* ── Search & Install ────────────────────────────────────────────── */}
      <Box mb={10}>
        <SectionHeading>2 · Find & Install a Piece</SectionHeading>
        <VStack align="stretch" gap={4}>
          <Step number={3} title="Search for an @activepieces piece on npm">
            <VStack align="stretch" gap={1.5}>
              <CopyableCode>fp search gmail</CopyableCode>
              <CopyableCode>fp search slack</CopyableCode>
              <CopyableCode>fp search --json | jq '.[].name'</CopyableCode>
            </VStack>
            <Text fontSize="xs" color="gray.500" mt={1.5}>
              Returns matching <Code fontSize="xs">@activepieces/piece-*</Code> packages from npm
              with descriptions and version info.
            </Text>
          </Step>

          <Step number={4} title="Install the piece">
            <VStack align="stretch" gap={1.5}>
              <CopyableCode>fp install slack</CopyableCode>
              <CopyableCode>fp install @activepieces/piece-gmail</CopyableCode>
            </VStack>
            <Text fontSize="xs" color="gray.500" mt={1.5}>
              This will:
            </Text>
            <VStack align="stretch" gap={0.5} mt={1} pl={2}>
              {[
                'npm install @activepieces/piece-<name>',
                'Generate src/pieces/npm-<name>.ts wrapper',
                'Register the piece in src/worker.ts via @fp:imports / @fp:register markers',
              ].map((line) => (
                <HStack key={line} gap={2} align="flex-start">
                  <Text fontSize="xs" color="blue.500" mt={0.5}>→</Text>
                  <Text fontSize="xs" color="gray.600">{line}</Text>
                </HStack>
              ))}
            </VStack>
            <Note>
              If the package name isn't found exactly, fp launches an interactive picker
              so you can choose from search results.
            </Note>
          </Step>

          <Step number={5} title="Or launch the interactive TUI">
            <CopyableCode>fp</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Browse and install pieces from a full-screen terminal UI — no package name needed.
            </Text>
          </Step>
        </VStack>
      </Box>

      {/* ── Secrets ─────────────────────────────────────────────────────── */}
      <Box mb={10}>
        <SectionHeading>3 · Configure Secrets</SectionHeading>
        <VStack align="stretch" gap={4}>
          <Step number={6} title="Set piece-specific auth secrets">
            <Text fontSize="xs" color="gray.600" mb={2}>
              Each piece requires different secrets depending on its auth type.
              The naming convention is <Code fontSize="xs" fontFamily="mono">PIECENAME_KEY</Code> in{' '}
              <Code fontSize="xs" fontFamily="mono">UPPER_SNAKE_CASE</Code>:
            </Text>
            <VStack align="stretch" gap={1.5}>
              <HStack gap={2} flexWrap="wrap" align="center">
                <Badge colorPalette="yellow" variant="subtle" fontSize="2xs">CUSTOM_AUTH</Badge>
                <CopyableCode>wrangler secret put SLACK_BOT_TOKEN</CopyableCode>
              </HStack>
              <HStack gap={2} flexWrap="wrap" align="center">
                <Badge colorPalette="orange" variant="subtle" fontSize="2xs">SECRET_TEXT</Badge>
                <CopyableCode>wrangler secret put OPENAI_TOKEN</CopyableCode>
              </HStack>
              <HStack gap={2} flexWrap="wrap" align="center">
                <Badge colorPalette="purple" variant="subtle" fontSize="2xs">OAUTH2</Badge>
                <CopyableCode>wrangler secret put GMAIL_CLIENT_ID</CopyableCode>
              </HStack>
              <HStack gap={2} flexWrap="wrap" align="center">
                <Badge colorPalette="purple" variant="subtle" fontSize="2xs">OAUTH2</Badge>
                <CopyableCode>wrangler secret put GMAIL_CLIENT_SECRET</CopyableCode>
              </HStack>
              <HStack gap={2} flexWrap="wrap" align="center">
                <Badge colorPalette="teal" variant="subtle" fontSize="2xs">BASIC_AUTH</Badge>
                <CopyableCode>wrangler secret put MYPIECE_USERNAME</CopyableCode>
              </HStack>
              <HStack gap={2} flexWrap="wrap" align="center">
                <Badge colorPalette="teal" variant="subtle" fontSize="2xs">BASIC_AUTH</Badge>
                <CopyableCode>wrangler secret put MYPIECE_PASSWORD</CopyableCode>
              </HStack>
            </VStack>
            <Note>
              Check the Settings → Secrets tab after deploying to see exactly which secrets each
              piece needs and whether they are set or missing.
            </Note>
          </Step>

          <Step number={7} title="Use fp config for an interactive secret-setting wizard">
            <CopyableCode>fp config</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Guides you through setting all known secrets interactively, including auto-generating
              random keys where appropriate (e.g.{' '}
              <Code fontSize="xs" fontFamily="mono">TOKEN_ENCRYPTION_KEY</Code>).
            </Text>
          </Step>

          <Step number={8} title="Set the token encryption key (required once per deployment)">
            <CopyableCode>{'openssl rand -hex 32 | wrangler secret put TOKEN_ENCRYPTION_KEY'}</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Required for all pieces that store OAuth tokens in KV.
            </Text>
          </Step>
        </VStack>
      </Box>

      {/* ── Env vars ────────────────────────────────────────────────────── */}
      <Box mb={10}>
        <SectionHeading>4 · Environment Variables</SectionHeading>
        <VStack align="stretch" gap={4}>
          <Step number={9} title="Set the public URL (non-secret, in wrangler.toml)">
            <Text fontSize="xs" color="gray.600" mb={2}>
              Add or update the <Code fontSize="xs" fontFamily="mono">[vars]</Code> section in{' '}
              <Code fontSize="xs" fontFamily="mono">wrangler.toml</Code>:
            </Text>
            <Box
              bg="gray.900"
              color="green.300"
              fontFamily="mono"
              fontSize="xs"
              px={3}
              py={2.5}
              rounded="md"
            >
              <Text color="gray.500"># wrangler.toml</Text>
              <Text mt={1}>[vars]</Text>
              <Text>{'FREEPIECES_PUBLIC_URL = "https://your-worker.workers.dev"'}</Text>
            </Box>
            <Note>
              This is not a secret — it's used for OAuth callback URLs and is safe to commit.
            </Note>
          </Step>

          <Step number={10} title="Wrangler.toml KV namespace binding">
            <Box
              bg="gray.900"
              color="green.300"
              fontFamily="mono"
              fontSize="xs"
              px={3}
              py={2.5}
              rounded="md"
            >
              <Text color="gray.500"># wrangler.toml</Text>
              <Text mt={1}>{'[[kv_namespaces]]'}</Text>
              <Text>{'binding = "TOKEN_STORE"'}</Text>
              <Text>{'id     = "<your-kv-namespace-id>"'}</Text>
            </Box>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Create a KV namespace with:{' '}
              <Code fontSize="xs" fontFamily="mono">wrangler kv namespace create TOKEN_STORE</Code>
            </Text>
          </Step>
        </VStack>
      </Box>

      {/* ── Deploy ──────────────────────────────────────────────────────── */}
      <Box mb={10}>
        <SectionHeading>5 · Deploy</SectionHeading>
        <VStack align="stretch" gap={4}>
          <Step number={11} title="Deploy with fp">
            <CopyableCode>fp deploy</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Runs <Code fontSize="xs" fontFamily="mono">npm run build:admin</Code> then{' '}
              <Code fontSize="xs" fontFamily="mono">wrangler deploy</Code>. Add{' '}
              <Code fontSize="xs" fontFamily="mono">-y</Code> to skip the confirmation prompt.
            </Text>
          </Step>

          <Step number={12} title="Or deploy manually">
            <VStack align="stretch" gap={1.5}>
              <CopyableCode>npm run build:admin</CopyableCode>
              <CopyableCode>wrangler deploy</CopyableCode>
            </VStack>
          </Step>

          <Step number={13} title="Enable the piece in this admin panel">
            <Text fontSize="xs" color="gray.600">
              After deploying, go to the{' '}
              <Text as="span" fontWeight="semibold">Pieces</Text> tab and click{' '}
              <Text as="span" fontWeight="semibold" color="green.600">Enable</Text> on the newly
              installed piece card.
            </Text>
          </Step>
        </VStack>
      </Box>

      {/* ── Remove ──────────────────────────────────────────────────────── */}
      <Box mb={10}>
        <SectionHeading>6 · Remove a Piece</SectionHeading>
        <VStack align="stretch" gap={4}>
          <Step number={14} title="Uninstall interactively">
            <CopyableCode>fp uninstall</CopyableCode>
            <Text fontSize="xs" color="gray.500" mt={1}>
              Opens an interactive picker to choose which installed pieces to remove.
              Deletes the wrapper file, removes the npm package, and cleans up imports.
            </Text>
          </Step>

          <Step number={15} title="Uninstall a specific piece">
            <CopyableCode>fp uninstall slack</CopyableCode>
            <Warn>
              This does not delete stored Cloudflare secrets. Run{' '}
              <Code fontSize="xs" fontFamily="mono">wrangler secret delete SLACK_BOT_TOKEN</Code>{' '}
              manually if you want to fully clean up.
            </Warn>
          </Step>
        </VStack>
      </Box>

      {/* ── Quick reference ─────────────────────────────────────────────── */}
      <Box
        bg="gray.900"
        rounded="lg"
        px={5}
        py={4}
      >
        <Text fontSize="xs" fontWeight="semibold" color="gray.400" mb={3} textTransform="uppercase" letterSpacing="wider">
          Quick Reference
        </Text>
        <VStack align="stretch" gap={1.5} fontFamily="mono" fontSize="xs">
          {[
            ['fp', 'Interactive TUI'],
            ['fp search <query>', 'Search npm for pieces'],
            ['fp install <name>', 'Install a piece'],
            ['fp uninstall', 'Remove installed pieces'],
            ['fp config', 'Set Cloudflare secrets interactively'],
            ['fp deploy', 'Build + deploy to Cloudflare'],
            ['fp init', 'Scaffold a brand-new project'],
          ].map(([cmd, desc]) => (
            <HStack key={cmd} gap={3} justify="space-between">
              <Text color="green.300" flexShrink={0}>{cmd}</Text>
              <Text color="gray.500" textAlign="right">{desc}</Text>
            </HStack>
          ))}
        </VStack>
      </Box>
    </Container>
  );
}
