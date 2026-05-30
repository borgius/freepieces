import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  ClipboardRoot,
  ClipboardTrigger,
  Code,
  Flex,
  HStack,
  Heading,
  Input,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { ChevronDown, ChevronRight, Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createProfile,
  deleteProfile,
  getProfilePieces,
  listProfiles,
  regenerateProfileToken,
  renameProfile,
  revokeProfileToken,
  setProfileToolEnabled,
  type Profile,
  type ProfilePieceTools,
} from '../lib/api';

// ---------------------------------------------------------------------------
// Per-piece tool selection for a profile
// ---------------------------------------------------------------------------

function ToolRow({
  item,
  busy,
  onToggle,
}: {
  item: { name: string; displayName: string; enabled: boolean };
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Flex align="center" justify="space-between" py={1}>
      <Text fontSize="xs" color="gray.700">{item.displayName}</Text>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
        title={item.enabled ? `Disable ${item.displayName}` : `Enable ${item.displayName}`}
      >
        <input
          aria-label={`Enable ${item.displayName}`}
          checked={item.enabled}
          disabled={busy}
          type="checkbox"
          onChange={(e) => onToggle(e.target.checked)}
        />
      </label>
    </Flex>
  );
}

function ProfileTools({ profileId }: { profileId: string }) {
  const [pieces, setPieces] = useState<ProfilePieceTools[] | null>(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getProfilePieces(profileId)
      .then((p) => active && setPieces(p))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Failed to load tools'));
    return () => {
      active = false;
    };
  }, [profileId]);

  const toggle = useCallback(
    async (pieceName: string, kind: 'action' | 'trigger', name: string, enabled: boolean) => {
      const key = `${pieceName}:${kind}:${name}`;
      setBusyKey(key);
      setError('');
      try {
        await setProfileToolEnabled(profileId, pieceName, kind, name, enabled);
        setPieces((prev) =>
          prev?.map((piece) =>
            piece.name !== pieceName
              ? piece
              : {
                  ...piece,
                  actions: kind === 'action'
                    ? piece.actions.map((a) => (a.name === name ? { ...a, enabled } : a))
                    : piece.actions,
                  triggers: kind === 'trigger'
                    ? piece.triggers.map((t) => (t.name === name ? { ...t, enabled } : t))
                    : piece.triggers,
                },
          ) ?? prev,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update tool');
      } finally {
        setBusyKey(null);
      }
    },
    [profileId],
  );

  if (error) return <Text color="red.500" fontSize="xs">{error}</Text>;
  if (!pieces) return <Spinner size="sm" />;
  if (pieces.length === 0) return <Text fontSize="xs" color="gray.500">No pieces installed.</Text>;

  return (
    <VStack align="stretch" gap={3}>
      {pieces.map((piece) => (
        <Box key={piece.name} borderWidth="1px" borderColor="gray.100" rounded="md" p={3}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.800" mb={1}>
            {piece.displayName}
          </Text>
          {piece.actions.length > 0 && (
            <Box mb={piece.triggers.length > 0 ? 2 : 0}>
              <Text fontSize="2xs" textTransform="uppercase" color="gray.400" mb={1}>Actions</Text>
              {piece.actions.map((a) => (
                <ToolRow
                  key={a.name}
                  item={a}
                  busy={busyKey === `${piece.name}:action:${a.name}`}
                  onToggle={(enabled) => void toggle(piece.name, 'action', a.name, enabled)}
                />
              ))}
            </Box>
          )}
          {piece.triggers.length > 0 && (
            <Box>
              <Text fontSize="2xs" textTransform="uppercase" color="gray.400" mb={1}>Triggers</Text>
              {piece.triggers.map((t) => (
                <ToolRow
                  key={t.name}
                  item={t}
                  busy={busyKey === `${piece.name}:trigger:${t.name}`}
                  onToggle={(enabled) => void toggle(piece.name, 'trigger', t.name, enabled)}
                />
              ))}
            </Box>
          )}
        </Box>
      ))}
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// ProfileCard
// ---------------------------------------------------------------------------

function ProfileCard({
  profile,
  onChange,
  onDelete,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  useEffect(() => setName(profile.name), [profile.name]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Box borderWidth="1px" borderColor="gray.200" rounded="lg" p={4} bg="white">
      <Flex align="center" gap={2} wrap="wrap">
        <Input
          size="sm"
          maxW="64"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== profile.name) void run(async () => onChange(await renameProfile(profile.id, next)));
            else setName(profile.name);
          }}
        />
        <Badge colorPalette={profile.hasToken ? 'green' : 'gray'} variant="subtle" fontSize="2xs">
          {profile.hasToken ? 'Token active' : 'No token'}
        </Badge>
        <Box flex={1} />
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void run(async () => {
            const { token, profile: updated } = await regenerateProfileToken(profile.id);
            setRevealedToken(token);
            onChange(updated);
          })}
        >
          <RefreshCw size={12} /> {profile.hasToken ? 'Regenerate token' : 'Generate token'}
        </Button>
        {profile.hasToken && (
          <Button
            size="xs"
            variant="outline"
            colorPalette="orange"
            disabled={busy}
            onClick={() => void run(async () => {
              onChange(await revokeProfileToken(profile.id));
              setRevealedToken(null);
            })}
          >
            Revoke
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          colorPalette="red"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete profile "${profile.name}"? Its token will stop working.`)) {
              void run(async () => {
                await deleteProfile(profile.id);
                onDelete(profile.id);
              });
            }
          }}
        >
          <Trash2 size={12} />
        </Button>
      </Flex>

      {revealedToken && (
        <Box mt={3} p={3} bg="yellow.50" borderWidth="1px" borderColor="yellow.200" rounded="md">
          <Text fontSize="xs" color="yellow.800" mb={2}>
            Copy this token now — it is shown only once. Use it as the <Code fontSize="2xs">Authorization</Code> bearer token (no <Code fontSize="2xs">X-User-Id</Code> header needed).
          </Text>
          <HStack>
            <Code fontSize="xs" wordBreak="break-all" flex={1}>{revealedToken}</Code>
            <ClipboardRoot value={revealedToken}>
              <ClipboardTrigger asChild>
                <Button size="xs" variant="outline"><Copy size={12} /> Copy</Button>
              </ClipboardTrigger>
            </ClipboardRoot>
          </HStack>
        </Box>
      )}

      {error && <Text color="red.500" fontSize="xs" mt={2}>{error}</Text>}

      <Flex
        as="button"
        align="center"
        gap={1}
        mt={3}
        fontSize="xs"
        color="gray.600"
        cursor="pointer"
        onClick={() => setShowTools((s) => !s)}
      >
        {showTools ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Available tools
      </Flex>
      {showTools && (
        <Box mt={3}>
          <ProfileTools profileId={profile.id} />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ProfilesPanel
// ---------------------------------------------------------------------------

export function ProfilesPanel() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listProfiles()
      .then(setProfiles)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load profiles'));
  }, []);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const profile = await createProfile(name);
      setProfiles((prev) => [...(prev ?? []), profile]);
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create profile');
    } finally {
      setCreating(false);
    }
  }, [newName]);

  return (
    <VStack align="stretch" gap={5} maxW="3xl">
      <Box>
        <Flex align="center" gap={2} mb={1}>
          <KeyRound size={18} />
          <Heading size="md">Profiles</Heading>
        </Flex>
        <Text fontSize="sm" color="gray.500">
          Create profiles with their own scoped API token and tool selection. Runtime clients
          (MCP, /run, /trigger) present a profile token to run as that profile — no X-User-Id header required.
        </Text>
      </Box>

      <HStack>
        <Input
          size="sm"
          placeholder="New profile name"
          value={newName}
          maxW="sm"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <Button size="sm" disabled={creating || !newName.trim()} onClick={() => void create()}>
          <Plus size={14} /> Add profile
        </Button>
      </HStack>

      {error && <Text color="red.500" fontSize="sm">{error}</Text>}

      {!profiles ? (
        <Spinner />
      ) : profiles.length === 0 ? (
        <Text fontSize="sm" color="gray.500">No profiles yet. Create one to get a scoped token.</Text>
      ) : (
        <VStack align="stretch" gap={3}>
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              onChange={(updated) =>
                setProfiles((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? prev)
              }
              onDelete={(id) => setProfiles((prev) => prev?.filter((p) => p.id !== id) ?? prev)}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}
