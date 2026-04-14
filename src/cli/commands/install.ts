import { spawnSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ora from 'ora';
import chalk from 'chalk';
import { select, isCancel, cancel } from '@clack/prompts';
import { getNpmPackageInfo, searchNpmPieces, type NpmPackageInfo } from '../util/npm-registry.js';
import { debug } from '../util/debug.js';
import { writePieceTypes, generateGeneratedIndex, generateSdkIndex } from '../util/typegen.js';

/** Reject package names that could inject shell arguments (10.1). */
const VALID_PIECE_RE = /^@activepieces\/piece-[a-z0-9][a-z0-9-]*$/;
function assertValidPieceName(pkg: string): void {
  if (!VALID_PIECE_RE.test(pkg)) {
    console.error(chalk.red(`Invalid piece name: ${chalk.bold(pkg)}`));
    console.error(chalk.dim('Expected format: @activepieces/piece-<name>  (lowercase letters, digits, hyphens)'));
    process.exit(1);
  }
}

/**
 * Install an @activepieces/piece-* npm package and generate a freepieces
 * wrapper stub in src/pieces/npm-<name>.ts.
 *
 * If the exact package is not found on npm, the query is used to search and
 * the user is prompted to pick a result interactively.
 */
export async function installCommand(packageName: string): Promise<void> {
  // Normalise package name
  const pkg = packageName.startsWith('@activepieces/piece-')
    ? packageName
    : `@activepieces/piece-${packageName}`;

  const cwd = process.cwd();

  if (!existsSync(join(cwd, 'package.json'))) {
    console.error(chalk.red('[E001] No package.json found.'));
    console.error(chalk.dim('  → Run `fp init` to scaffold a new project, or cd into an existing one.'));
    process.exit(1);
  }

  // 1. Fetch metadata — fall back to interactive search when not found exactly
  const spinner = ora(`Fetching ${chalk.cyan(pkg)} metadata…`).start();
  let meta: NpmPackageInfo;
  try {
    meta = await getNpmPackageInfo(pkg);
    spinner.succeed(`Found ${pkg}@${meta.version}`);
  } catch {
    spinner.warn(`Package ${chalk.cyan(pkg)} not found on npm — searching…`);

    let results: NpmPackageInfo[] = [];
    const searchSpinner = ora('Searching npm…').start();
    try {
      results = await searchNpmPieces(packageName.replace(/^@activepieces\/piece-/i, ''));
      searchSpinner.succeed(`Found ${results.length} package(s)`);
    } catch (err) {
      searchSpinner.fail(String(err));
      process.exit(1);
    }

    if (results.length === 0) {
      console.log(chalk.yellow('No matching packages found.'));
      process.exit(1);
    }

    const chosen = await select({
      message: 'Select a piece to install:',
      options: results.map((r) => ({
        value: r.name,
        label: r.name,
        hint: r.description ? r.description.slice(0, 60) : undefined,
      })),
    });

    if (isCancel(chosen)) {
      cancel('Cancelled');
      process.exit(0);
    }

    const chosenPkg = chosen as string;
    const metaSpinner = ora(`Fetching ${chalk.cyan(chosenPkg)} metadata…`).start();
    try {
      meta = await getNpmPackageInfo(chosenPkg);
      metaSpinner.succeed(`Found ${chosenPkg}@${meta.version}`);
    } catch (err) {
      metaSpinner.fail(`[E003] Could not fetch metadata for ${chosenPkg}`);
      process.exit(1);
    }

    // Re-derive resolved pkg name from selection
    return installResolved(meta.name, meta, cwd);
  }

  return installResolved(pkg, meta, cwd);
}

async function installResolved(
  pkg: string,
  meta: NpmPackageInfo,
  cwd: string,
): Promise<void> {
  assertValidPieceName(pkg);

  // 2. npm install
  debug('install', `running npm install ${pkg}`);
  const s2 = ora(`Installing ${pkg}…`).start();
  const npmResult = spawnSync('npm', ['install', pkg], { cwd, encoding: 'utf-8', stdio: 'pipe' });
  if (npmResult.error || npmResult.status !== 0) {
    s2.fail(`[E004] npm install failed — check your network or npm registry access.`);
    if (npmResult.stderr) process.stderr.write(npmResult.stderr + '\n');
    process.exit(1);
  }
  s2.succeed(`Installed ${pkg}`);
  debug('install', `npm install done, status=${npmResult.status}`);

  // 3. Generate wrapper stub
  const pieceName = pkg.replace('@activepieces/piece-', '');
  const symbolName = toPieceSymbol(pieceName) + 'Piece';
  const wrapperFile = join(cwd, 'src', 'pieces', `npm-${pieceName}.ts`);

  if (!existsSync(join(cwd, 'src', 'pieces'))) {
    mkdirSync(join(cwd, 'src', 'pieces'), { recursive: true });
  }

  const wrapper = generateWrapper(pkg, pieceName, symbolName, meta.description ?? '');

  const s3 = ora(`Generating wrapper src/pieces/npm-${pieceName}.ts…`).start();
  try {
    await writeFile(wrapperFile, wrapper, 'utf-8');
    s3.succeed(`Wrapper created: src/pieces/npm-${pieceName}.ts`);
  } catch (err) {
    s3.fail(String(err));
    process.exit(1);
  }

  // 3b. Generate types in src/sdk/generated/ from the AP piece's runtime prop structure
  const sdkGenDir = join(cwd, 'src', 'sdk', 'generated');
  if (!existsSync(sdkGenDir)) {
    mkdirSync(sdkGenDir, { recursive: true });
  }
  const typesFile = join(sdkGenDir, `npm-${pieceName}.ts`);
  const s3b = ora(`Generating types src/sdk/generated/npm-${pieceName}.ts…`).start();
  try {
    const apExportKey = toPieceSymbol(pieceName);
    const req = createRequire(join(cwd, 'package.json'));
    const entryPath = req.resolve(pkg);
    const mod = await import(pathToFileURL(entryPath).href);
    const apPiece = mod.default?.[apExportKey] ?? mod[apExportKey] ?? mod.default;
    if (apPiece && (apPiece._actions || apPiece.actions)) {
      await writePieceTypes(typesFile, pieceName, apPiece);
      s3b.succeed(`Types generated: src/sdk/generated/npm-${pieceName}.ts`);
    } else {
      s3b.warn('Could not resolve piece object — skipping typegen');
    }

    // Regenerate the barrel index files so the SDK stays in sync
    const sdkDir = join(cwd, 'src', 'sdk');
    await generateGeneratedIndex(sdkGenDir);
    await generateSdkIndex(sdkDir);
    debug('install', 'regenerated sdk/generated/index.ts and sdk/index.ts');
  } catch (err) {
    s3b.warn(`Typegen failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    debug('install', `typegen error: ${err}`);
  }

  // 4. Update src/pieces/index.ts marker block if it exists
  const indexPath = join(cwd, 'src', 'pieces', 'index.ts');
  if (existsSync(indexPath)) {
    await addPieceToRegistry(indexPath, pieceName);
  }

  console.log(
    `\n${chalk.green('✓')} ${chalk.bold(pkg)} installed.\n` +
      `  Wrapper: ${chalk.cyan(`src/pieces/npm-${pieceName}.ts`)}\n` +
      `  Types:   ${chalk.cyan(`src/sdk/generated/npm-${pieceName}.ts`)}\n` +
      `  Set auth secrets with  wrangler secret put  then run ${chalk.green('fp deploy')}.\n`,
  );
}

// ─── Exported helpers (used by tui.ts) ────────────────────────────────────

/** Convert kebab-case piece name to camelCase symbol name. */
export function toPieceSymbol(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Generate a zero-adapt AP-native wrapper file for an npm @activepieces piece. */
export function generateWrapper(pkg: string, pieceName: string, symbolName: string, description: string): string {
  const envPrefix = pieceName.toUpperCase().replace(/-/g, '_');
  const apExportKey = toPieceSymbol(pieceName);   // e.g. 'slack', 'gmail', 'gitHub'
  return `/**
 * ${pkg} — native Activepieces integration.
 * ${description}
 *
 * Auto-generated by \`fp install ${pkg}\`.
 *
 * Set required auth secrets (check the @activepieces/${pieceName} auth definition):
 *   npx wrangler secret put ${envPrefix}_TOKEN   # or _BOT_TOKEN, _CLIENT_ID, etc.
 */
import pkg from '${pkg}';
import { registerApPiece } from '../framework/registry.js';
import type { ApPiece } from '../framework/types.js';

const ${symbolName} = (pkg as unknown as { ${apExportKey}: ApPiece }).${apExportKey};
registerApPiece('${pieceName}', ${symbolName});
`;
}

async function addPieceToRegistry(indexPath: string, pieceName: string): Promise<void> {
  const PIECES_START = '// @fp:pieces:start';
  const PIECES_END = '// @fp:pieces:end';

  let content = await readFile(indexPath, 'utf-8');
  if (!content.includes(PIECES_START)) return; // no markers — skip

  const importLine = `import './npm-${pieceName}.js';`;
  if (content.includes(importLine)) return; // already present

  const ri = content.indexOf(PIECES_END);
  content = content.slice(0, ri) + importLine + '\n' + content.slice(ri);
  await writeFile(indexPath, content, 'utf-8');
}
