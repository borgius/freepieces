/**
 * fp codegen — regenerate all auto-generated SDK files.
 *
 * Regenerates in order:
 *   1. src/sdk/generated/npm-*.ts    — per-piece types (from installed AP packages)
 *   2. src/sdk/generated/index.ts   — KnownPieces, knownPieceNames, barrel re-exports
 *   3. src/sdk/index.ts             — public SDK entry point
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  regenerateAllPieceTypes,
  generateGeneratedIndex,
  generateSdkIndex,
} from '../util/typegen.js';
import { debug } from '../util/debug.js';

export async function codegenCommand(): Promise<void> {
  const cwd = process.cwd();

  const generatedDir = join(cwd, 'src', 'sdk', 'generated');
  const sdkDir       = join(cwd, 'src', 'sdk');

  if (!existsSync(generatedDir)) {
    process.stderr.write(
      chalk.red('[E010] src/sdk/generated/ not found.\n') +
      chalk.dim('  → Run `fp init` to scaffold the project first.\n'),
    );
    process.exit(1);
  }

  // 1. Regenerate per-piece type files (npm-*.ts)
  const s1 = ora('Regenerating piece type files…').start();
  try {
    const results = await regenerateAllPieceTypes(generatedDir, cwd);

    if (results.length === 0) {
      s1.info('No npm-*.ts piece files found — skipping per-piece regeneration');
    } else {
      const ok     = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);

      s1.succeed(`Piece types regenerated (${ok.length}/${results.length})`);
      for (const r of ok) {
        console.log(`  ${chalk.green('✓')} npm-${r.pieceName}.ts`);
      }
      for (const r of failed) {
        console.log(`  ${chalk.yellow('⚠')} npm-${r.pieceName}.ts — ${r.error}`);
      }
      debug('codegen', `piece regen: ${ok.length} ok, ${failed.length} failed`);
    }
  } catch (err) {
    s1.fail(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 2. Regenerate generated/index.ts
  const s2 = ora('Generating src/sdk/generated/index.ts…').start();
  try {
    await generateGeneratedIndex(generatedDir);
    s2.succeed(chalk.green('src/sdk/generated/index.ts') + ' updated');
    debug('codegen', 'generated/index.ts done');
  } catch (err) {
    s2.fail(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 3. Regenerate sdk/index.ts
  const s3 = ora('Generating src/sdk/index.ts…').start();
  try {
    await generateSdkIndex(sdkDir);
    s3.succeed(chalk.green('src/sdk/index.ts') + ' updated');
    debug('codegen', 'sdk/index.ts done');
  } catch (err) {
    s3.fail(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`\n${chalk.green('✓')} All SDK files regenerated.\n`);
}

