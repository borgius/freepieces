import { useEffect, useState } from 'react';
import { ChakraProvider, defaultSystem, Center, Spinner } from '@chakra-ui/react';
import { LoginPage } from './pages/LoginPage';
import { PiecesPage } from './pages/PiecesPage';
import { getMe } from './lib/api';

type View = 'loading' | 'login' | 'pieces';

export function App() {
  const [view, setView] = useState<View>('loading');
  const [username, setUsername] = useState('');

  useEffect(() => {
    getMe()
      .then(({ username: u }) => {
        setUsername(u);
        setView('pieces');
      })
      .catch(() => setView('login'));
  }, []);

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
            setView('pieces');
          }}
        />
      )}

      {view === 'pieces' && (
        <PiecesPage
          username={username}
          onLogout={() => {
            setUsername('');
            setView('login');
          }}
        />
      )}
    </ChakraProvider>
  );
}
