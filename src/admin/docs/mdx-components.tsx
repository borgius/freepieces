import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import {
  Box,
  Code,
  Heading,
  Link,
  Separator,
  Text,
} from '@chakra-ui/react';

export interface DocsMdxComponentOptions {
  onNavigateDoc: (slug: string, hash?: string) => void;
}

function textFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }

      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textFromChildren(child.props.children);
      }

      return '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function resolveInternalDocLink(href: string): { slug: string; hash?: string } | null {
  const [path, hash] = href.split('#');
  const match = path.match(/^(?:\.\/|\/?docs\/)?([^/]+)\.mdx?$/i);
  if (!match) {
    return null;
  }

  return {
    slug: match[1],
    hash,
  };
}

interface HeadingProps {
  as: 'h1' | 'h2' | 'h3' | 'h4';
  size: '2xl' | 'xl' | 'lg' | 'md';
  mt: number;
  children: ReactNode;
}

function DocHeading({ as, size, mt, children }: HeadingProps) {
  const id = slugify(textFromChildren(children));

  return (
    <Heading
      as={as}
      id={id || undefined}
      size={size}
      mt={mt}
      mb={4}
      color="gray.900"
      lineHeight="1.2"
      scrollMarginTop="88px"
    >
      {children}
    </Heading>
  );
}

function DocCode({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
  const text = textFromChildren(children);
  const isBlock = Boolean(className?.includes('language-')) || text.includes('\n');

  if (isBlock) {
    return (
      <Box
        as="code"
        display="block"
        minW="max-content"
        color="gray.100"
        fontFamily="mono"
        fontSize="sm"
        lineHeight="1.7"
        whiteSpace="pre"
        {...props}
      >
        {text.replace(/\n$/, '')}
      </Box>
    );
  }

  return (
    <Code
      fontSize="0.95em"
      colorPalette="blue"
      variant="subtle"
      px={1.5}
      py={0.5}
      rounded="md"
      {...props}
    >
      {children}
    </Code>
  );
}

export function createDocsMdxComponents({ onNavigateDoc }: DocsMdxComponentOptions) {
  return {
    h1: ({ children }: { children: ReactNode }) => (
      <DocHeading as="h1" size="2xl" mt={0}>
        {children}
      </DocHeading>
    ),
    h2: ({ children }: { children: ReactNode }) => (
      <DocHeading as="h2" size="xl" mt={10}>
        {children}
      </DocHeading>
    ),
    h3: ({ children }: { children: ReactNode }) => (
      <DocHeading as="h3" size="lg" mt={8}>
        {children}
      </DocHeading>
    ),
    h4: ({ children }: { children: ReactNode }) => (
      <DocHeading as="h4" size="md" mt={6}>
        {children}
      </DocHeading>
    ),
    p: ({ children }: { children: ReactNode }) => (
      <Text mb={4} color="gray.700" lineHeight="1.85">
        {children}
      </Text>
    ),
    ul: ({ children }: { children: ReactNode }) => (
      <Box as="ul" pl={6} my={4} color="gray.700" css={{ listStyleType: 'disc' }}>
        {children}
      </Box>
    ),
    ol: ({ children }: { children: ReactNode }) => (
      <Box as="ol" pl={6} my={4} color="gray.700" css={{ listStyleType: 'decimal' }}>
        {children}
      </Box>
    ),
    li: ({ children }: { children: ReactNode }) => (
      <Box as="li" mb={2}>
        {children}
      </Box>
    ),
    blockquote: ({ children }: { children: ReactNode }) => (
      <Box
        my={6}
        rounded="xl"
        borderLeftWidth="4px"
        borderColor="blue.300"
        bg="blue.50"
        px={4}
        py={3}
      >
        <Text color="blue.900" lineHeight="1.8">
          {children}
        </Text>
      </Box>
    ),
    a: ({ href = '', children, ...props }: ComponentPropsWithoutRef<'a'>) => {
      const internalDoc = resolveInternalDocLink(href);
      if (internalDoc) {
        return (
          <Link
            as="button"
            type="button"
            color="blue.600"
            fontWeight="medium"
            textDecoration="underline"
            textUnderlineOffset="3px"
            _hover={{ color: 'blue.700' }}
            onClick={(event) => {
              event.preventDefault();
              onNavigateDoc(internalDoc.slug, internalDoc.hash);
            }}
            {...props}
          >
            {children}
          </Link>
        );
      }

      const isExternal = /^https?:\/\//i.test(href);
      return (
        <Link
          href={href}
          color="blue.600"
          fontWeight="medium"
          textDecoration="underline"
          textUnderlineOffset="3px"
          _hover={{ color: 'blue.700' }}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
          {...props}
        >
          {children}
        </Link>
      );
    },
    pre: ({ children }: { children: ReactNode }) => (
      <Box
        as="pre"
        my={6}
        rounded="xl"
        bg="gray.950"
        borderWidth="1px"
        borderColor="gray.800"
        overflowX="auto"
        px={5}
        py={4}
      >
        {children}
      </Box>
    ),
    code: DocCode,
    table: ({ children }: { children: ReactNode }) => (
      <Box my={6} overflowX="auto">
        <Box as="table" w="full" borderCollapse="collapse" fontSize="sm">
          {children}
        </Box>
      </Box>
    ),
    thead: ({ children }: { children: ReactNode }) => <Box as="thead">{children}</Box>,
    tbody: ({ children }: { children: ReactNode }) => <Box as="tbody">{children}</Box>,
    tr: ({ children }: { children: ReactNode }) => (
      <Box as="tr" _hover={{ bg: 'gray.50' }}>
        {children}
      </Box>
    ),
    th: ({ children }: { children: ReactNode }) => (
      <Box
        as="th"
        bg="gray.100"
        color="gray.700"
        fontWeight="semibold"
        textAlign="left"
        px={3}
        py={2.5}
      >
        {children}
      </Box>
    ),
    td: ({ children }: { children: ReactNode }) => (
      <Box as="td" borderTopWidth="1px" borderColor="gray.200" px={3} py={2.5} verticalAlign="top">
        {children}
      </Box>
    ),
    hr: () => <Separator my={8} />,
  };
}
