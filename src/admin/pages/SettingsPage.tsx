import { useState } from 'react';
import { Box, Flex, Text, VStack } from '@chakra-ui/react';
import { KeyRound } from 'lucide-react';
import { SecretsPanel } from '../components/SecretsPanel';

type Section = 'secrets';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'secrets', label: 'Secrets', icon: <KeyRound size={14} /> },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>('secrets');

  return (
    <Flex minH="calc(100vh - 56px)">
      {/* Left sidebar */}
      <Box
        w="52"
        borderRightWidth="1px"
        borderColor="gray.200"
        bg="white"
        p={3}
        flexShrink={0}
      >
        <Text fontSize="2xs" fontWeight="semibold" color="gray.400" textTransform="uppercase" px={2} mb={2}>
          Settings
        </Text>
        <VStack align="stretch" gap={0.5}>
          {SECTIONS.map(({ id, label, icon }) => (
            <Flex
              key={id}
              as="button"
              align="center"
              gap={2}
              px={3}
              py={2}
              rounded="md"
              fontSize="sm"
              fontWeight={activeSection === id ? 'semibold' : 'normal'}
              color={activeSection === id ? 'blue.700' : 'gray.600'}
              bg={activeSection === id ? 'blue.50' : 'transparent'}
              _hover={{ bg: activeSection === id ? 'blue.50' : 'gray.50' }}
              cursor="pointer"
              onClick={() => setActiveSection(id)}
              w="full"
              textAlign="left"
            >
              <Box flexShrink={0} color={activeSection === id ? 'blue.500' : 'gray.400'}>
                {icon}
              </Box>
              {label}
            </Flex>
          ))}
        </VStack>
      </Box>

      {/* Content */}
      <Box flex={1} p={8} maxW="3xl">
        {activeSection === 'secrets' && <SecretsPanel />}
      </Box>
    </Flex>
  );
}
