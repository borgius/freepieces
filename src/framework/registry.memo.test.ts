import { beforeEach, describe, expect, it } from 'vitest';

import {
  listPieces,
  registerPiece,
  registerApPiece,
  getTrigger,
  __resetRegistryForTests,
} from './registry';
import type { PieceDefinition, ApPiece } from './types';

function nativePiece(name: string): PieceDefinition {
  return {
    name,
    displayName: name,
    version: '0.1.0',
    auth: { type: 'none' },
    actions: [
      { name: 'ping', displayName: 'Ping', run: async () => 'pong' },
    ],
    triggers: [
      { name: 'tick', displayName: 'Tick', type: 'POLLING', run: async () => [] },
    ],
  } as unknown as PieceDefinition;
}

function apPiece(name: string): ApPiece {
  return {
    displayName: name,
    description: name,
    auth: [],
    _actions: {
      act: { name: 'act', displayName: 'Act', run: async () => null },
    },
    _triggers: {
      trig: { name: 'trig', displayName: 'Trig', type: 'WEBHOOK', run: async () => [] },
    },
  } as unknown as ApPiece;
}

describe('registry memoization', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('returns the same cached reference across calls when nothing changed', () => {
    registerPiece(nativePiece('alpha'));
    const a = listPieces();
    const b = listPieces();
    expect(b).toBe(a);
  });

  it('invalidates the cache when a new native piece is registered', () => {
    registerPiece(nativePiece('alpha'));
    const a = listPieces();
    registerPiece(nativePiece('beta'));
    const b = listPieces();
    expect(b).not.toBe(a);
    expect(b.map((p) => p.name)).toEqual(['alpha', 'beta']);
  });

  it('invalidates the cache when an AP piece is registered', () => {
    registerPiece(nativePiece('alpha'));
    const a = listPieces();
    registerApPiece('slack-like', apPiece('Slackish'));
    const b = listPieces();
    expect(b).not.toBe(a);
    expect(b.map((p) => p.name)).toContain('slack-like');
  });
});

describe('getTrigger fast index', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('resolves native triggers', () => {
    registerPiece(nativePiece('alpha'));
    expect(getTrigger('alpha', 'tick')?.name).toBe('tick');
    expect(getTrigger('alpha', 'missing')).toBeUndefined();
  });

  it('resolves AP triggers', () => {
    registerApPiece('slack-like', apPiece('Slackish'));
    expect(getTrigger('slack-like', 'trig')?.name).toBe('trig');
  });

  it('reflects triggers added after the first lookup (index invalidation)', () => {
    registerPiece(nativePiece('alpha'));
    expect(getTrigger('alpha', 'tick')?.name).toBe('tick');
    registerApPiece('beta', apPiece('Beta'));
    expect(getTrigger('beta', 'trig')?.name).toBe('trig');
  });
});
