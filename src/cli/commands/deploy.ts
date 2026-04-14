import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import {
  intro,
  outro,
  confirm,
  spinner as clackSpinner,
  log,
  isCancel,
} from '@clack/prompts';
import { debug } from '../util/debug.js';

export async function deployCommand(opts: { yes?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();

  if (!existsSync(join(cwd, 'wrangler.toml'))) {
    console.error(chalk.red('[E002] No wrangler.toml found.'));
    console.error(chalk.dim('  → Run `fp init` to scaffold a new project, or cd into an existing one.'));
    process.exit(1);
  }

  intro(' freepieces deploy ');

  if (!opts.yes) {
    const ok = await confirm({ message: 'Build admin SPA and deploy to Cloudflare?', initialValue: true });
    if (isCancel(ok) || !ok) {
      process.exit(0);
    }
  }

  const s = clackSpinner();

  // Build admin SPA if vite config exists
  if (existsSync(join(cwd, 'vite.config.admin.ts')) || existsSync(join(cwd, 'vite.config.admin.js'))) {
    s.start('Building admin SPA…');
    debug('deploy', 'npm run build:admin');
    const buildResult = spawnSync('npm', ['run', 'build:admin'], { cwd, encoding: 'utf-8', stdio: 'pipe' });
    if (buildResult.error || buildResult.status !== 0) {
      s.stop('Admin build failed (continuing)');
      debug('deploy', buildResult.stderr ?? '');
      log.warn('Admin SPA build failed — the Worker will deploy without updated UI assets.');
    } else {
      s.stop('Admin SPA built');
    }
  }

  // Wrangler deploy
  s.start('Deploying to Cloudflare Workers…');
  debug('deploy', 'npx wrangler deploy');
  const deployResult = spawnSync('npx', ['wrangler', 'deploy'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (deployResult.error || deployResult.status !== 0) {
    s.stop('[E005] Deployment failed');
    if (deployResult.stderr) process.stderr.write(deployResult.stderr + '\n');
    log.error('Run `npx wrangler deploy` directly for full output, or `npx wrangler login` if unauthenticated.');
    process.exit(1);
  }
  s.stop('Deployed!');
  const urlMatch = (deployResult.stdout ?? '').match(/https:\/\/[a-z0-9-]+\.workers\.dev/);
  if (urlMatch) {
    outro(`Live at ${chalk.cyan(urlMatch[0])}`);
  } else {
    outro('Deployment complete.');
  }
}
