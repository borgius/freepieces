import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Center,
  Container,
  Flex,
  HStack,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { DOCS, DOC_SECTIONS, getDocBySlug } from '../docs/content';
import { createDocsMdxComponents } from '../docs/mdx-components';
import type { DocEntry, DocSectionId } from '../docs/types';

const SECTION_STYLES: Record<DocSectionId, { colorPalette: string; softBg: string }> = {
  'getting-started': { colorPalette: 'green', softBg: 'green.50' },
  architecture: { colorPalette: 'purple', softBg: 'purple.50' },
  runtime: { colorPalette: 'blue', softBg: 'blue.50' },
};

interface DocNavItemProps {
  doc: DocEntry;
  active: boolean;
  onSelect: (slug: string) => void;
}

function DocNavItem({ doc, active, onSelect }: DocNavItemProps) {
  const sectionStyle = SECTION_STYLES[doc.meta.section];

  return (
    <Flex
      as="button"
      direction="column"
      align="stretch"
      gap={2}
      w="full"
      rounded="xl"
      borderWidth="1px"
      borderColor={active ? `${sectionStyle.colorPalette}.200` : 'gray.200'}
      bg={active ? sectionStyle.softBg : 'white'}
      px={3}
      py={3}
      textAlign="left"
      transition="all 0.18s"
      _hover={{ borderColor: `${sectionStyle.colorPalette}.200`, bg: active ? sectionStyle.softBg : 'gray.50' }}
      onClick={() => onSelect(doc.meta.slug)}
    >
      <HStack justify="space-between" align="flex-start">
        <Text fontSize="sm" fontWeight={active ? 'semibold' : 'medium'} color={active ? 'gray.900' : 'gray.700'}>
          {doc.meta.title}
        </Text>
        <Badge colorPalette={sectionStyle.colorPalette} variant={active ? 'solid' : 'subtle'} flexShrink={0}>
          {doc.meta.estimatedTime}
        </Badge>
      </HStack>
      <Text fontSize="xs" color="gray.500" lineHeight="1.6">
        {doc.meta.summary}
      </Text>
    </Flex>
  );
}

export function DocsPage() {
  const [activeSlug, setActiveSlug] = useState(DOCS[0]?.meta.slug ?? 'quick-start');
  const [pendingHash, setPendingHash] = useState<string | undefined>();

  const activeDoc = getDocBySlug(activeSlug) ?? DOCS[0];
  const activeIndex = DOCS.findIndex((doc) => doc.meta.slug === activeDoc.meta.slug);
  const previousDoc = activeIndex > 0 ? DOCS[activeIndex - 1] : undefined;
  const nextDoc = activeIndex >= 0 && activeIndex < DOCS.length - 1 ? DOCS[activeIndex + 1] : undefined;

  const navigateToDoc = useCallback((slug: string, hash?: string) => {
    setActiveSlug(slug);
    setPendingHash(hash);
  }, []);

  const mdxComponents = useMemo(
    () => createDocsMdxComponents({ onNavigateDoc: navigateToDoc }),
    [navigateToDoc]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (pendingHash) {
        const target = document.getElementById(pendingHash);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setPendingHash(undefined);
        return;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeSlug, pendingHash]);

  const groupedDocs = DOC_SECTIONS.map((section) => ({
    section,
    items: DOCS.filter((doc) => doc.meta.section === section.id),
  })).filter((group) => group.items.length > 0);

  const sectionStyle = SECTION_STYLES[activeDoc.meta.section];
  const ActiveDoc = useMemo(() => lazy(activeDoc.load), [activeDoc]);

  return (
    <Flex direction={{ base: 'column', lg: 'row' }} minH="calc(100vh - 56px)">
      <Box
        as="aside"
        w={{ base: 'full', lg: '22rem' }}
        flexShrink={0}
        borderRightWidth={{ base: '0', lg: '1px' }}
        borderBottomWidth={{ base: '1px', lg: '0' }}
        borderColor="gray.200"
        bg="white"
        px={4}
        py={5}
      >
        <Box mb={5} px={2}>
          <Text fontSize="2xs" fontWeight="semibold" color="gray.400" textTransform="uppercase" letterSpacing="wider" mb={2}>
            Documentation
          </Text>
          <Text fontSize="sm" color="gray.600" lineHeight="1.7">
            Browse the same guides that live in <Box as="span" fontFamily="mono">docs/*.mdx</Box>, now rendered inside the admin UI.
          </Text>
        </Box>

        <VStack align="stretch" gap={5}>
          {groupedDocs.map(({ section, items }) => (
            <Box key={section.id}>
              <Box px={2} mb={2.5}>
                <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                  {section.title}
                </Text>
                <Text fontSize="xs" color="gray.400" mt={1} lineHeight="1.6">
                  {section.description}
                </Text>
              </Box>
              <VStack align="stretch" gap={2}>
                {items.map((doc) => (
                  <DocNavItem
                    key={doc.meta.slug}
                    doc={doc}
                    active={doc.meta.slug === activeDoc.meta.slug}
                    onSelect={(slug) => navigateToDoc(slug)}
                  />
                ))}
              </VStack>
            </Box>
          ))}
        </VStack>
      </Box>

      <Box flex={1} bg="gray.50" px={{ base: 4, md: 6, xl: 8 }} py={6}>
        <Container maxW="6xl" px={0}>
          <Box rounded="2xl" borderWidth="1px" borderColor="gray.200" bg="white" px={{ base: 5, md: 8 }} py={{ base: 5, md: 8 }} boxShadow="sm">
            <HStack justify="space-between" align="center" mb={6} flexWrap="wrap" gap={3}>
              <HStack gap={3} flexWrap="wrap">
                <Badge colorPalette={sectionStyle.colorPalette} variant="subtle">
                  {DOC_SECTIONS.find((section) => section.id === activeDoc.meta.section)?.title}
                </Badge>
                <Badge variant="outline">{activeDoc.meta.estimatedTime}</Badge>
              </HStack>
              <Text fontSize="sm" color="gray.500">
                Source: <Box as="span" fontFamily="mono">docs/{activeDoc.meta.slug}.mdx</Box>
              </Text>
            </HStack>

            <Box color="gray.700">
              <Suspense
                fallback={
                  <Center py={12}>
                    <Spinner size="lg" colorPalette="blue" />
                  </Center>
                }
              >
                <ActiveDoc components={mdxComponents} />
              </Suspense>
            </Box>

            <Flex
              direction={{ base: 'column', md: 'row' }}
              justify="space-between"
              gap={3}
              mt={10}
              pt={6}
              borderTopWidth="1px"
              borderColor="gray.200"
            >
              <Button
                variant="outline"
                justifyContent="space-between"
                onClick={() => previousDoc && navigateToDoc(previousDoc.meta.slug)}
                disabled={!previousDoc}
              >
                <ArrowLeft size={14} />
                {previousDoc ? previousDoc.meta.title : 'Start of docs'}
              </Button>
              <Button
                variant="outline"
                justifyContent="space-between"
                onClick={() => nextDoc && navigateToDoc(nextDoc.meta.slug)}
                disabled={!nextDoc}
              >
                {nextDoc ? nextDoc.meta.title : 'You are at the end'}
                <ArrowRight size={14} />
              </Button>
            </Flex>
          </Box>
        </Container>
      </Box>
    </Flex>
  );
}
