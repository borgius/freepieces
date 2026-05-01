import { describe, expect, it } from 'vitest';
import { headersToMap, parseRecipients } from './gmail';

describe('headersToMap', () => {
  it('lowercases keys and preserves values', () => {
    expect(
      headersToMap([
        { name: 'From', value: 'alice@example.com' },
        { name: 'SUBJECT', value: 'Hello' },
      ]),
    ).toEqual({ from: 'alice@example.com', subject: 'Hello' });
  });

  it('returns an empty map for undefined', () => {
    expect(headersToMap(undefined)).toEqual({});
  });
});

describe('parseRecipients', () => {
  it('splits, trims, and excludes the current user', () => {
    expect(
      parseRecipients('Alice <alice@example.com>, bob@example.com , carol@example.com', 'bob@example.com'),
    ).toEqual(['Alice <alice@example.com>', 'carol@example.com']);
  });

  it('returns an empty list for undefined input', () => {
    expect(parseRecipients(undefined, 'x@example.com')).toEqual([]);
  });

  it('drops empty segments', () => {
    expect(parseRecipients(', ,alice@example.com,', 'nobody@example.com')).toEqual(['alice@example.com']);
  });
});
