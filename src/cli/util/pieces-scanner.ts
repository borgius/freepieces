import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface NativePiece {
  /** File basename without extension, e.g. "gmail" */
  name: string;
  /** Absolute path to the .ts source file */
  file: string;
  kind: 'native';
}

/** Scan src/pieces/ for native piece files (excluding *.test.ts). */
export async function scanNativePieces(projectRoot: string): Promise<NativePiece[]> {
  const piecesDir = join(projectRoot, 'src', 'pieces');
  if (!existsSync(piecesDir)) return [];
  const files = await readdir(piecesDir);
  return files
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({
      name: basename(f, '.ts'),
      file: join(piecesDir, f),
      kind: 'native' as const,
    }));
}

/** Return true when the project root looks like a freepieces project. */
export function isFreepieces(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, 'src', 'worker.ts')) &&
    existsSync(join(projectRoot, 'wrangler.toml'))
  );
}

/** Derive the wrangler worker name from wrangler.toml. */
export async function readWorkerName(projectRoot: string): Promise<string | undefined> {
  const toml = join(projectRoot, 'wrangler.toml');
  if (!existsSync(toml)) return undefined;
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(toml, 'utf-8');
  const match = content.match(/^name\s*=\s*"([^"]+)"/m);
  return match?.[1];
}
