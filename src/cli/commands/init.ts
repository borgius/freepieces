import {
  intro,
  outro,
  text,
  password,
  confirm,
  spinner as clackSpinner,
  log,
  isCancel,
  cancel,
  note,
} from '@clack/prompts';
import { execSync } from 'node:child_process';
import { mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {
  createKVNamespace,
  setWranglerSecret,
  isWranglerAuthed,
  runWranglerInteractive,
  generateHexSync,
} from '../util/wrangler.js';

// Resolve the freepieces package root so we can copy src/ into new projects.
// Compiled path: dist/cli/commands/init.js → go up 3 levels → package root
const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(__filename), '..', '..', '..');

// ─── Embedded Templates ────────────────────────────────────────────────────

function makePackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'wrangler dev',
        'build:admin': 'vite build --config vite.config.admin.ts',
        deploy: 'npm run build:admin && wrangler deploy',
        check: 'tsc --noEmit',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.20260405.0',
        '@types/node': '^22.0.0',
        '@vitejs/plugin-react': '^4.0.0',
        typescript: '^5.8.0',
        vite: '^6.0.0',
        wrangler: '^4.0.0',
      },
      dependencies: {
        '@chakra-ui/react': '^3.0.0',
        'lucide-react': '^0.400.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    },
    null,
    2,
  );
}

function makeWranglerToml(workerName: string, kvId: string, publicUrl: string): string {
  return `name = "${workerName}"
main = "src/worker.ts"
compatibility_date = "2026-04-14"
compatibility_flags = ["nodejs_compat"]

[vars]
FREEPIECES_PUBLIC_URL = "${publicUrl}"

[[kv_namespaces]]
binding = "TOKEN_STORE"
id = "${kvId}"

[assets]
directory = "./dist/public"
binding = "ASSETS"
`;
}

function makeTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'WebWorker'],
        strict: true,
        noEmit: true,
        types: ['@cloudflare/workers-types'],
        skipLibCheck: true,
      },
      include: ['src'],
      exclude: ['src/client', 'src/admin'],
    },
    null,
    2,
  );
}

function makeGitignore(): string {
  return `node_modules/
dist/
.wrangler/
.env
*.local
`;
}

function makeEnvFile(
  publicUrl: string,
  kvId: string,
  adminUser: string,
  adminPass: string,
  tokenKey: string,
  signingKey: string,
): string {
  return [
    `FREEPIECES_PUBLIC_URL=${publicUrl}`,
    `TOKEN_STORE_ID=${kvId}`,
    `ADMIN_USER=${adminUser}`,
    `ADMIN_PASSWORD=${adminPass}`,
    `TOKEN_ENCRYPTION_KEY=${tokenKey}`,
    `ADMIN_SIGNING_KEY=${signingKey}`,
  ].join('\n') + '\n';
}

// ─── Main wizard ──────────────────────────────────────────────────────────

export async function initCommand(opts: { name?: string } = {}): Promise<void> {
  intro(' freepieces init — Cloudflare Worker setup wizard ');

  // 1. Worker name
  let workerName = opts.name as string | undefined;
  if (!workerName) {
    const answer = await text({
      message: 'Worker name (Cloudflare slug):',
      placeholder: 'my-pieces-worker',
      validate(v) {
        if (!v?.trim()) return 'Required';
        if (!/^[a-z0-9][a-z0-9-]*$/.test(v.trim()))
          return 'Only lowercase letters, numbers, and hyphens (must start with a letter/digit)';
      },
    });
    if (isCancel(answer)) {
      cancel('Init cancelled');
      process.exit(0);
    }
    workerName = (answer as string).trim();
  }

  // 2. Target directory
  const defaultDir = `./${workerName}`;
  const dirAnswer = await text({
    message: 'Project directory:',
    placeholder: defaultDir,
    defaultValue: defaultDir,
  });
  if (isCancel(dirAnswer)) {
    cancel('Init cancelled');
    process.exit(0);
  }
  const projectPath = resolve(process.cwd(), (dirAnswer as string).trim() || defaultDir);

  // 3. Create directory and scaffold
  const s = clackSpinner();
  const dirExists = existsSync(projectPath);
  if (!dirExists) {
    await mkdir(projectPath, { recursive: true });
  }

  // Check if this looks like an existing freepieces project
  const hasWorker = existsSync(join(projectPath, 'src', 'worker.ts'));
  const hasWrangler = existsSync(join(projectPath, 'wrangler.toml'));
  const isExisting = hasWorker && hasWrangler;

  if (!isExisting) {
    s.start('Copying freepieces source files…');
    await copySourceTree(projectPath);
    s.stop('Source files copied');

    s.start('Writing project config files…');
    // We'll fill in package.json, tsconfig, gitignore now; wrangler.toml later
    await writeFile(join(projectPath, 'tsconfig.json'), makeTsConfig(), 'utf-8');
    await writeFile(join(projectPath, '.gitignore'), makeGitignore(), 'utf-8');
    s.stop('Config files written');

    s.start('Running npm install…');
    execSync('npm install', { cwd: projectPath, stdio: 'pipe' });
    s.stop('Dependencies installed');
  } else {
    log.info(`Using existing project at ${projectPath}`);
  }

  // 4. Cloudflare auth
  if (!isWranglerAuthed(projectPath)) {
    const doLogin = await confirm({
      message: 'Log in to Cloudflare with wrangler?',
      initialValue: true,
    });
    if (isCancel(doLogin)) {
      cancel('Init cancelled');
      process.exit(0);
    }
    if (doLogin) {
      await runWranglerInteractive(['login'], projectPath);
    } else {
      log.warn('Skipping Cloudflare login — some steps may fail.');
    }
  }

  // 5. KV namespace
  s.start('Creating KV namespace TOKEN_STORE…');
  let kvId = '';
  try {
    kvId = await createKVNamespace('TOKEN_STORE', projectPath);
    s.stop(`KV namespace created: ${kvId}`);
  } catch {
    s.stop('Auto-creation failed');
    const kvAnswer = await text({
      message:
        'Enter KV namespace ID manually\n  (run: npx wrangler kv namespace create TOKEN_STORE)',
      placeholder: '32-char hex id',
      validate(v) {
        if (!v || !/^[a-f0-9]{32}$/.test(v.trim())) return 'Expected 32 lowercase hex characters';
      },
    });
    if (isCancel(kvAnswer)) {
      cancel('Init cancelled');
      process.exit(0);
    }
    kvId = (kvAnswer as string).trim();
  }

  // 6. Public URL
  const defaultUrl = `https://${workerName}.workers.dev`;
  const urlAnswer = await text({
    message: 'Public URL for your worker:',
    placeholder: defaultUrl,
    defaultValue: defaultUrl,
  });
  if (isCancel(urlAnswer)) {
    cancel('Init cancelled');
    process.exit(0);
  }
  const publicUrl = ((urlAnswer as string).trim() || defaultUrl);

  // 7. Admin credentials
  const adminUserAnswer = await text({
    message: 'Admin UI username:',
    placeholder: 'admin',
    defaultValue: 'admin',
  });
  if (isCancel(adminUserAnswer)) {
    cancel('Init cancelled');
    process.exit(0);
  }

  const adminPassAnswer = await password({
    message: 'Admin UI password (min 8 chars):',
    validate(v) {
      if ((v?.length ?? 0) < 8) return 'Minimum 8 characters';
    },
  });
  if (isCancel(adminPassAnswer)) {
    cancel('Init cancelled');
    process.exit(0);
  }

  const adminUser = (adminUserAnswer as string).trim() || 'admin';
  const adminPass = adminPassAnswer as string;

  // 8. Generate secure keys
  const tokenKey = generateHexSync(32);
  const signingKey = generateHexSync(32);

  // 9. Write wrangler.toml and package.json
  s.start('Writing wrangler.toml…');
  await writeFile(
    join(projectPath, 'wrangler.toml'),
    makeWranglerToml(workerName, kvId, publicUrl),
    'utf-8',
  );
  if (!isExisting) {
    await writeFile(
      join(projectPath, 'package.json'),
      makePackageJson(workerName),
      'utf-8',
    );
  }
  s.stop('wrangler.toml written');

  // 10. Write .env for local dev
  await writeFile(
    join(projectPath, '.env'),
    makeEnvFile(publicUrl, kvId, adminUser, adminPass, tokenKey, signingKey),
    'utf-8',
  );
  log.success('.env written (keep this secret, it is gitignored)');

  // 11. Set Cloudflare secrets
  s.start('Setting Cloudflare Worker secrets…');
  const secretErrors: string[] = [];
  for (const [name, value] of [
    ['ADMIN_USER', adminUser],
    ['ADMIN_PASSWORD', adminPass],
    ['TOKEN_ENCRYPTION_KEY', tokenKey],
    ['ADMIN_SIGNING_KEY', signingKey],
  ] as [string, string][]) {
    try {
      setWranglerSecret(name, value, projectPath);
    } catch (err) {
      secretErrors.push(`${name}: ${String(err)}`);
    }
  }
  if (secretErrors.length) {
    s.stop('Some secrets failed to set');
    log.warn(secretErrors.join('\n'));
    note(
      'Set them manually:\n' +
        '  echo "value" | npx wrangler secret put SECRET_NAME',
      'Manual secret setup',
    );
  } else {
    s.stop('Secrets set');
  }

  // 12. Deploy?
  const doDeploy = await confirm({
    message: 'Build and deploy to Cloudflare now?',
    initialValue: true,
  });

  if (!isCancel(doDeploy) && doDeploy) {
    s.start('Building admin SPA…');
    try {
      execSync('npm run build:admin', { cwd: projectPath, stdio: 'pipe' });
      s.stop('Admin SPA built');
    } catch {
      s.stop('Admin build failed — ensure vite/react deps are installed');
    }

    s.start('Deploying to Cloudflare…');
    try {
      execSync('npx wrangler deploy', { cwd: projectPath, stdio: 'inherit' });
      s.stop('Deployed!');
    } catch {
      s.stop('Deploy failed');
      log.warn('Run `npm run deploy` inside the project directory when ready.');
    }
  }

  outro(
    `Done!  Project: ${projectPath}\n\n` +
      `  cd ${(dirAnswer as string).trim() || defaultDir}\n` +
      `  fp tui        # select and deploy pieces\n` +
      `  fp deploy     # redeploy\n` +
      `  fp config     # manage secrets\n`,
  );
}

// ─── Source tree copy ──────────────────────────────────────────────────────

async function copySourceTree(dest: string): Promise<void> {
  const srcDirs = ['src', 'vite.config.admin.ts', 'vite.config.ts', 'tsconfig.admin.json', 'tsconfig.client.json'];
  for (const item of srcDirs) {
    const srcPath = join(PACKAGE_ROOT, item);
    const destPath = join(dest, item);
    if (existsSync(srcPath)) {
      try {
        await cp(srcPath, destPath, { recursive: true });
      } catch {
        // Skip items that fail (e.g. already exist)
      }
    }
  }
}
