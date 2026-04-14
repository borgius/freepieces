import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  ChakraProvider,
  Center,
  Flex,
  HStack,
  Heading,
  Spinner,
  Text,
  defaultSystem,
} from '@chakra-ui/react';
import { LogOut } from 'lucide-react';
import { LoginPage } from './pages/LoginPage';
import { PiecesPage } from './pages/PiecesPage';
import { SettingsPage } from './pages/SettingsPage';
import { AddPiecePage } from './pages/AddPiecePage';
import { getMe, logout } from './lib/api';

type View = 'loading' | 'login' | 'app';
type Tab = 'pieces' | 'add-piece' | 'settings';

export function App() {
  const [view, setView] = useState<View>('loading');
  const [username, setUsername] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('pieces');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    getMe()
      .then(({ username: u }) => {
        setUsername(u);
        setView('app');
      })
      .catch(() => setView('login'));
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setUsername('');
      setActiveTab('pieces');
      setView('login');
    }
  }

  return (
    <ChakraProvider value={defaultSystem}>
      {view === 'loading' && (
        <Center minH="100vh">
          <Spinner size="xl" colorPalette="blue" />
        </Center>
      )}

      {view === 'login' && (
        <LoginPage
          onLogin={(u) => {
            setUsername(u);
            setView('app');
          }}
        />
      )}

      {view === 'app' && (
        <Box minH="100vh" bg="gray.50">
          {/* Shared navbar */}
          <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" px={6} py={0}>
            <Flex align="center" justify="space-between" maxW="7xl" mx="auto" h="56px">
              <HStack gap={8}>
                <Heading size="md" fontWeight="bold" color="gray.800">
                  Freepieces
                </Heading>
                {/* Tab buttons */}
                <HStack gap={0}>
                  {([['pieces', 'Pieces'], ['add-piece', 'Add Piece'], ['settings', 'Settings']] as [Tab, string][]).map(([tab, label]) => (
                    <Box
                      key={tab}
                      as="button"
                      px={4}
                      h="56px"
                      fontSize="sm"
                      fontWeight="medium"
                      color={activeTab === tab ? 'blue.600' : 'gray.500'}
                      borderBottomWidth="2px"
                      borderColor={activeTab === tab ? 'blue.500' : 'transparent'}
                      _hover={{ color: 'gray.800' }}
                      transition="all 0.15s"
                      onClick={() => setActiveTab(tab)}
                    >
                      {label}
                    </Box>
                  ))}
                </HStack>
              </HStack>
              <HStack gap={4}>
                <Text fontSize="sm" color="gray.500">{username}</Text>
                <Button
                  size="sm"
                  variant="outline"
                  colorPalette="gray"
                  loading={loggingOut}
                  onClick={handleLogout}
                >
                  <LogOut size={14} />
                  Sign out
                </Button>
              </HStack>
            </Flex>
          </Box>

          {/* Tab content */}
          {activeTab === 'pieces' && <PiecesPage />}
          {activeTab === 'add-piece' && <AddPiecePage />}
          {activeTab === 'settings' && <SettingsPage />}
        </Box>
      )}
    </ChakraProvider>
  );
}
