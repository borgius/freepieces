#!/usr/bin/env node
/**
 * freepieces CLI — fp
 *
 * Commands:
 *   fp                  Interactive TUI piece selector (default)
 *   fp tui              Interactive TUI piece selector
 *   fp init             Wizard to scaffold a new Worker deployment
 *   fp search [query]   Search npm for @activepieces/piece-* packages
 *   fp install <pkg>    Install an npm piece and generate a wrapper
 *   fp config           Configure Worker secrets interactively
 *   fp deploy           Build admin SPA and deploy to Cloudflare
 */

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
let version = '0.1.0';
try {
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    version = pkg.version ?? version;
  }
} catch { /* ignore */ }

const program = new Command();

program
  .name('fp')
  .description('freepieces — Cloudflare Worker piece manager')
  .version(version);

// Default action: launch TUI
program.action(async () => {
  const { tuiCommand } = await import('./commands/tui.js');
  await tuiCommand();
});

program
  .command('tui')
  .description('Interactive piece selector (TUI)')
  .action(async () => {
    const { tuiCommand } = await import('./commands/tui.js');
    await tuiCommand();
  });

program
  .command('init')
  .description('Wizard to scaffold and configure a new Cloudflare Worker deployment')
  .option('-n, --name <name>', 'Worker name (skips the prompt)')
  .action(async (opts: { name?: string }) => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand(opts);
  });

program
  .command('search [query]')
  .description('Search npm for @activepieces/piece-* packages')
  .action(async (query?: string) => {
    const { searchCommand } = await import('./commands/search.js');
    await searchCommand(query);
  });

program
  .command('install <package>')
  .description('Install an npm @activepieces piece and generate a wrapper stub')
  .action(async (pkg: string) => {
    const { installCommand } = await import('./commands/install.js');
    await installCommand(pkg);
  });

program
  .command('config')
  .description('Configure Cloudflare Worker secrets interactively')
  .action(async () => {
    const { configCommand } = await import('./commands/config.js');
    await configCommand();
  });

program
  .command('deploy')
  .description('Build admin SPA and deploy to Cloudflare Workers')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { yes?: boolean }) => {
    const { deployCommand } = await import('./commands/deploy.js');
    await deployCommand(opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
