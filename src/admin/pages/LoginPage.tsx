import { useState } from 'react';
import {
  Box,
  Button,
  Heading,
  Stack,
  Text
} from '@chakra-ui/react';
import { getLoginUrl } from '../lib/api';

export function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(provider: string) {
    setError('');
    setLoading(true);
    try {
      const { url } = await getLoginUrl(provider);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start login');
      setLoading(false);
    }
  }

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="gray.50">
      <Box
        bg="white"
        p={8}
        rounded="xl"
        shadow="md"
        w="full"
        maxW="400px"
        mx={4}
      >
        <Heading size="xl" mb={2} textAlign="center">
          Freepieces
        </Heading>
        <Text color="gray.500" textAlign="center" mb={8} fontSize="sm">
          Admin Console
        </Text>

        <Stack gap={3}>
          <Button
            colorPalette="blue"
            size="lg"
            w="full"
            loading={loading}
            onClick={() => handleLogin('code')}
          >
            Sign in with Email
          </Button>

          <Button
            variant="outline"
            size="lg"
            w="full"
            loading={loading}
            onClick={() => handleLogin('google')}
          >
            Sign in with Google
          </Button>

          <Button
            variant="outline"
            size="lg"
            w="full"
            loading={loading}
            onClick={() => handleLogin('github')}
          >
            Sign in with GitHub
          </Button>

          {error && (
            <Text color="red.500" fontSize="sm" textAlign="center">
              {error}
            </Text>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
