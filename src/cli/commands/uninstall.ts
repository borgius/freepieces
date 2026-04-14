import { readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import { multiselect, confirm, isCancel, cancel, log } from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { debug } from '../util/debug.js';
import { toPieceSymbol } from './install.js';

interface InstalledNpmPiece {
  /** Short piece name, e.g. "slack", "gmail" */
  name: string;
  /** Absolute path to the wrapper file */
  file: string;
}

/** Scan src/pieces/ for npm-* wrapper files and return installed piece names. */
async function scanInstalledNpmPieces(cwd: string): Promise<InstalledNpmPiece[]> {
  const piecesDir = join(cwd, 'src', 'pieces');
  if (!existsSync(piecesDir)) return [];
  const files = await readdir(piecesDir);
  return files
    .filter((f) => f.startsWith('npm-') && f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({
      name: basename(f, '.ts').replace(/^npm-/, ''),
      file: join(piecesDir, f),
    }));
}

/** Remove a piece's import line from src/pieces/index.ts. */
async function removePieceFromRegistry(indexPath: string, pieceName: string): Promise<void> {
  if (!existsSync(indexPath)) return;
  let content = await readFile(indexPath, 'utf-8');
  content = content.replace(new RegExp(`\\nimport '\\.\/npm-${pieceName}\\.js';`, 'g'), '');
  await writeFile(indexPath, content, 'utf-8');
}

/** Uninstall one or more pieces by name. */
async function removePieces(names: string[], cwd: string, allInstalled: InstalledNpmPiece[]): Promise<void> {
  const indexPath = join(cwd, 'src', 'pieces', 'index.ts');

  for (const name of names) {
    const piece = allInstalled.find((p) => p.name === name);
    if (!piece) {
      log.warn(`Piece ${chalk.cyan(name)} not found — skipping.`);
      continue;
    }

    const spinner = ora(`Removing ${chalk.cyan(name)}…`).start();

    // Delete wrapper file
    try {
      await unlink(piece.file);
    } catch (err) {
      spinner.fail(`Failed to delete wrapper file: ${String(err)}`);
      continue;
    }

    // Remove from index.ts
    await removePieceFromRegistry(indexPath, name);

    // npm uninstall
    debug('uninstall', `npm uninstall @activepieces/piece-${name}`);
    const result = spawnSync('npm', ['uninstall', `@activepieces/piece-${name}`], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    if (result.error) debug('uninstall', `npm uninstall error: ${result.error.message}`);
    // Non-fatal — the package may not have been in package.json

    spinner.succeed(`Removed ${chalk.cyan(name)}`);
  }
}

export async function uninstallCommand(packageName?: string): Promise<void> {
  const cwd = process.cwd();

  if (!existsSync(join(cwd, 'package.json'))) {
    console.error(chalk.red('[E001] No package.json found.'));
    console.error(chalk.dim('  → Run `fp init` to scaffold a new project, or cd into an existing one.'));
    process.exit(1);
  }

  const installed = await scanInstalledNpmPieces(cwd);
  if (installed.length === 0) {
    console.log(chalk.yellow('No npm pieces installed.'));
    return;
  }

  // Normalise the supplied name (strip @activepieces/piece- prefix)
  const requestedName = packageName
    ? packageName.replace(/^@activepieces\/piece-/, '')
    : undefined;

  const matched = requestedName ? installed.find((p) => p.name === requestedName) : undefined;

  let toRemove: string[];

  if (matched) {
    // Exact match — just confirm
    const ok = await confirm({
      message: `Remove piece ${chalk.cyan(matched.name)} and its wrapper file?`,
    });
    if (isCancel(ok) || !ok) {
      cancel('Cancelled');
      return;
    }
    toRemove = [matched.name];
  } else {
    // No match or no name given — interactive multiselect
    if (requestedName) {
      log.warn(`Piece ${chalk.cyan(requestedName)} is not installed.`);
    }

    const answer = await multiselect({
      message: 'Select pieces to remove (space = toggle, enter = confirm):',
      options: installed.map((p) => ({
        value: p.name,
        label: p.name,
        hint: `src/pieces/npm-${p.name}.ts`,
      })),
      required: true,
    });

    if (isCancel(answer)) {
      cancel('Cancelled');
      return;
    }

    const selected = answer as string[];

    const ok = await confirm({
      message: `Remove ${selected.length} piece(s): ${selected.map((n) => chalk.cyan(n)).join(', ')}?`,
    });
    if (isCancel(ok) || !ok) {
      cancel('Cancelled');
      return;
    }

    toRemove = selected;
  }

  await removePieces(toRemove, cwd, installed);

  console.log(`\n${chalk.green('✓')} Done. Run ${chalk.green('fp deploy')} to apply changes.\n`);
}
