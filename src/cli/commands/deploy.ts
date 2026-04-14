import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import ora from 'ora';
import chalk from 'chalk';
import {
  intro,
  outro,
  confirm,
  spinner as clackSpinner,
  log,
  isCancel,
} from '@clack/prompts';

export async function deployCommand(opts: { yes?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();

  if (!existsSync(join(cwd, 'wrangler.toml'))) {
    console.error(
      chalk.red('No wrangler.toml found. Run `fp init` first or cd into your project.'),
    );
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
    try {
      execSync('npm run build:admin', { cwd, stdio: 'pipe' });
      s.stop('Admin SPA built');
    } catch (err) {
      s.stop('Admin build failed');
      log.warn(String(err));
      // Continue anyway — the worker itself can deploy without the admin SPA
    }
  }

  // Wrangler deploy
  s.start('Deploying to Cloudflare Workers…');
  try {
    const output = execSync('npx wrangler deploy', { cwd, encoding: 'utf-8', stdio: 'pipe' });
    s.stop('Deployed!');
    // Extract URL from wrangler output
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.workers\.dev/);
    if (urlMatch) {
      outro(`Live at ${chalk.cyan(urlMatch[0])}`);
    } else {
      outro('Deployment complete.');
    }
  } catch (err) {
    s.stop('Deployment failed');
    log.error(String(err));
    process.exit(1);
  }
}
