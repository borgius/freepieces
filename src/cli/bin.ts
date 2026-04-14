#!/usr/bin/env node
/**
 * freepieces CLI — fp
 *
 * Commands:
 *   fp                    Interactive TUI piece selector (default)
 *   fp tui                Interactive TUI piece selector
 *   fp init               Wizard to scaffold a new Worker deployment
 *   fp search [query]     Search npm for @activepieces/piece-* packages
 *   fp install <pkg>      Install an npm piece and generate a wrapper
 *   fp uninstall [pkg]    Remove an npm piece and its wrapper (alias: remove)
 *   fp config             Configure Worker secrets interactively
 *   fp deploy             Build admin SPA and deploy to Cloudflare
 */

import { Command, Option } from 'commander';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { debug } from './util/debug.js';

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

// 1.8 — Respect POSIX signals: exit cleanly on SIGTERM so process managers
// (Docker, systemd, npm scripts) can shut down the CLI gracefully.
process.on('SIGTERM', () => process.exit(0));

const program = new Command();

program
  .name('fp')
  .description('freepieces — Cloudflare Worker piece manager')
  .version(version, '-V, --version')
  // Show help after unknown command / missing required arg errors (1.2 — empathic CLIs)
  .showHelpAfterError('(add --help for additional information)')
  // Route commander's own error output through our version-stamped handler (9.4)
  .configureOutput({
    writeErr: (str) => process.stderr.write(`fp v${version}: ${str}`),
  })
  // 6.3 — Debug mode: log the active command name before every action
  .hook('preAction', (thisCommand, actionCommand) => {
    debug('cmd', `running: ${actionCommand.name()}`);
  })
  .addHelpText(
    'after',
    `
Examples:
  fp                              Launch the interactive TUI
  fp search gmail                 Search for Gmail pieces on npm
  fp search --json | jq '.[].name'  Pipe results as JSON
  fp install slack                Install the Slack piece
  fp uninstall                    Pick installed pieces to remove
  fp config                       Set Cloudflare Worker secrets
  fp deploy -y                    Deploy without confirmation prompt

Debug:
  DEBUG=fp:* fp install slack     Enable verbose debug output`,
  );

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
  .command('search')
  .description('Search npm for @activepieces/piece-* packages')
  .argument('[query]', 'Package name fragment to search for (e.g. "gmail", "slack")')
  .addOption(new Option('--json', 'Output results as newline-delimited JSON (machine-readable)'))
  .action(async (query: string | undefined, opts: { json?: boolean }) => {
    const { searchCommand } = await import('./commands/search.js');
    await searchCommand(query, opts);
  });

program
  .command('install')
  .description('Install an npm @activepieces piece and generate a wrapper stub')
  .argument('<package>', 'Piece name or full @activepieces/piece-<name> package')
  .action(async (pkg: string) => {
    const { installCommand } = await import('./commands/install.js');
    await installCommand(pkg);
  });

program
  .command('uninstall')
  .alias('remove')
  .description('Uninstall an npm @activepieces piece and remove its wrapper stub')
  .argument('[package]', 'Piece name to remove; omit to pick interactively')
  .action(async (pkg: string | undefined) => {
    const { uninstallCommand } = await import('./commands/uninstall.js');
    await uninstallCommand(pkg);
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
  const msg = err instanceof Error ? err.message : String(err);
  // 9.4 — Include version in error output to aid bug reports
  process.stderr.write(`fp v${version}: ${msg}\n`);
  process.exit(1);
});

