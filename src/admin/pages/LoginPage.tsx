import { useState } from 'react';
import {
  Box,
  Button,
  Field,
  Heading,
  Input,
  Stack,
  Text
} from '@chakra-ui/react';
import { login } from '../lib/api';

interface Props {
  onLogin: (username: string) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      onLogin(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
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

        <form onSubmit={handleSubmit}>
          <Stack gap={4}>
            <Field.Root>
              <Field.Label>Username</Field.Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                autoFocus
                required
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </Field.Root>

            {error && (
              <Text color="red.500" fontSize="sm">
                {error}
              </Text>
            )}

            <Button
              type="submit"
              colorPalette="blue"
              loading={loading}
              loadingText="Signing in…"
              size="lg"
              w="full"
              mt={2}
            >
              Sign in
            </Button>
          </Stack>
        </form>
      </Box>
    </Box>
  );
}
