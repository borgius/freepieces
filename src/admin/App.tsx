import { Suspense, lazy, useEffect, useState } from 'react';
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
import { getMe, logout } from './lib/api';
import { parseAdminUrl, pushAdminUrl, type Tab, type Section } from './lib/adminUrl';

type View = 'loading' | 'login' | 'app';

const PiecesPage = lazy(async () => {
  const module = await import('./pages/PiecesPage');
  return { default: module.PiecesPage };
});

const AddPiecePage = lazy(async () => {
  const module = await import('./pages/AddPiecePage');
  return { default: module.AddPiecePage };
});

const SettingsPage = lazy(async () => {
  const module = await import('./pages/SettingsPage');
  return { default: module.SettingsPage };
});

const DocsPage = lazy(async () => {
  const module = await import('./pages/DocsPage');
  return { default: module.DocsPage };
});

export function App() {
  const [view, setView] = useState<View>('loading');
  const [currentUserId, setCurrentUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [nav, setNav] = useState(() => parseAdminUrl());
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    getMe()
      .then(({ userId, email }) => {
        setCurrentUserId(userId);
        setUserEmail(email);
        setView('app');
      })
      .catch(() => setView('login'));
  }, []);

  // Sync state with browser back/forward
  useEffect(() => {
    function handlePop() { setNav(parseAdminUrl()); }
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  function navigateTab(tab: Tab) {
    pushAdminUrl(tab);
    setNav({ tab, section: 'secrets', triggerId: undefined });
  }

  function navigateSection(section: Section) {
    pushAdminUrl('settings', section);
    setNav((n) => ({ ...n, section, triggerId: undefined }));
  }

  function navigateTriggerId(triggerId: string | undefined) {
    pushAdminUrl('settings', 'triggers', triggerId);
    setNav((n) => ({ ...n, triggerId }));
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setCurrentUserId('');
      setUserEmail('');
      pushAdminUrl('pieces');
      setNav({ tab: 'pieces', section: 'secrets', triggerId: undefined });
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

      {view === 'login' && <LoginPage />}

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
                  {([['pieces', 'Pieces'], ['add-piece', 'Add Piece'], ['docs', 'Docs'], ['settings', 'Settings']] as [Tab, string][]).map(([tab, label]) => (
                    <Box
                      key={tab}
                      as="button"
                      px={4}
                      h="56px"
                      fontSize="sm"
                      fontWeight="medium"
                      color={nav.tab === tab ? 'blue.600' : 'gray.500'}
                      borderBottomWidth="2px"
                      borderColor={nav.tab === tab ? 'blue.500' : 'transparent'}
                      _hover={{ color: 'gray.800' }}
                      transition="all 0.15s"
                      onClick={() => navigateTab(tab)}
                    >
                      {label}
                    </Box>
                  ))}
                </HStack>
              </HStack>
              <HStack gap={4}>
                <Text fontSize="sm" color="gray.500">{userEmail}</Text>
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
          <Suspense
            fallback={
              <Center minH="320px">
                <Spinner size="lg" colorPalette="blue" />
              </Center>
            }
          >
            {nav.tab === 'pieces' && <PiecesPage currentUserId={currentUserId} />}
            {nav.tab === 'add-piece' && <AddPiecePage />}
            {nav.tab === 'docs' && <DocsPage />}
            {nav.tab === 'settings' && (
              <SettingsPage
                section={nav.section}
                triggerId={nav.triggerId}
                onSectionChange={navigateSection}
                onTriggerIdChange={navigateTriggerId}
              />
            )}
          </Suspense>
        </Box>
      )}
    </ChakraProvider>
  );
}
