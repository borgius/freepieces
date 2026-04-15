import {
  Box,
  ChakraProvider,
  Flex,
  HStack,
  Heading,
  Link,
  Text,
  defaultSystem,
} from '@chakra-ui/react';
import { DocsPage } from '../admin/pages/DocsPage';

export function DocsApp() {
  return (
    <ChakraProvider value={defaultSystem}>
      <Box minH="100vh" bg="gray.50">
        <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" px={6} py={0}>
          <Flex align="center" justify="space-between" maxW="7xl" mx="auto" h="56px">
            <HStack gap={3}>
              <Heading size="md" fontWeight="bold" color="gray.800">
                Freepieces
              </Heading>
              <Text fontSize="sm" color="gray.500">
                Documentation
              </Text>
            </HStack>
            <HStack gap={4}>
              <Link
                href="https://github.com/borgius/freepieces"
                target="_blank"
                rel="noopener noreferrer"
                fontSize="sm"
                color="gray.500"
                _hover={{ color: 'gray.800' }}
              >
                GitHub
              </Link>
              <Link
                href="https://www.npmjs.com/package/freepieces"
                target="_blank"
                rel="noopener noreferrer"
                fontSize="sm"
                color="gray.500"
                _hover={{ color: 'gray.800' }}
              >
                npm
              </Link>
            </HStack>
          </Flex>
        </Box>
        <DocsPage />
      </Box>
    </ChakraProvider>
  );
}
