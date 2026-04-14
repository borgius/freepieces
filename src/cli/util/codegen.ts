import { readFile, writeFile } from 'node:fs/promises';

const IMPORT_START = '// @fp:imports:start';
const IMPORT_END = '// @fp:imports:end';
const REGISTER_START = '// @fp:register:start';
const REGISTER_END = '// @fp:register:end';

export interface PieceCodeEntry {
  /** JS symbol name used in the import, e.g. "gmailPiece" */
  symbol: string;
  /** Import path relative to worker.ts, e.g. "./pieces/gmail" */
  importPath: string;
}

function replaceBlock(
  content: string,
  startMarker: string,
  endMarker: string,
  inner: string,
): string {
  const si = content.indexOf(startMarker);
  const ei = content.indexOf(endMarker);
  if (si === -1 || ei === -1) return content;
  return (
    content.slice(0, si) +
    startMarker +
    '\n' +
    inner +
    (inner ? '\n' : '') +
    content.slice(ei)
  );
}

/**
 * Rewrite the @fp marker blocks in worker.ts with the given set of pieces.
 * Creates the markers if they are missing (appended at the end of the file).
 */
export async function syncWorkerPieces(
  workerPath: string,
  pieces: PieceCodeEntry[],
): Promise<void> {
  let content = await readFile(workerPath, 'utf-8');

  const importLines = pieces
    .map((p) => `import { ${p.symbol} } from '${p.importPath}';`)
    .join('\n');
  const registerLines = pieces.map((p) => `registerPiece(${p.symbol});`).join('\n');

  if (!content.includes(IMPORT_START)) {
    // Append marker blocks if they don't exist
    content +=
      `\n${IMPORT_START}\n${IMPORT_END}\n` +
      `\n${REGISTER_START}\n${REGISTER_END}\n`;
  }

  content = replaceBlock(content, IMPORT_START, IMPORT_END, importLines);
  content = replaceBlock(content, REGISTER_START, REGISTER_END, registerLines);

  await writeFile(workerPath, content, 'utf-8');
}

/**
 * Parse currently-registered pieces from the @fp marker block.
 * Returns symbol names found between @fp:register markers.
 */
export async function readRegisteredPieces(workerPath: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(workerPath, 'utf-8');
  } catch {
    return [];
  }
  const si = content.indexOf(REGISTER_START);
  const ei = content.indexOf(REGISTER_END);
  if (si === -1 || ei === -1) return [];
  const block = content.slice(si + REGISTER_START.length, ei);
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('registerPiece('))
    .map((l) => l.replace('registerPiece(', '').replace(');', '').trim());
}
