import {
  intro,
  outro,
  multiselect,
  text,
  confirm,
  spinner as clackSpinner,
  log,
  isCancel,
  cancel,
  note,
} from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { searchNpmPieces, type NpmPackageInfo } from '../util/npm-registry.js';
import { scanNativePieces } from '../util/pieces-scanner.js';
import { syncWorkerPieces, readRegisteredPieces, type PieceCodeEntry } from '../util/codegen.js';
import { generateWrapper, toPieceSymbol } from './install.js';
import { debug } from '../util/debug.js';
export async function tuiCommand(): Promise<void> {
  const cwd = process.cwd();

  intro(' freepieces — piece selector ');

  const workerPath = join(cwd, 'src', 'worker.ts');
  const hasFreepieces = existsSync(workerPath);

  if (!hasFreepieces) {
    note(
      `No src/worker.ts found.\nRun ${chalk.green('fp init')} to create a new deployment project.`,
      'Not a freepieces project',
    );
    outro('');
    return;
  }

  // ── 1. Collect currently-registered pieces ──────────────────────────────
  const currentSymbols = await readRegisteredPieces(workerPath);

  // ── 2. Scan native pieces ────────────────────────────────────────────────
  const nativePieces = await scanNativePieces(cwd);

  // Build native options
  const nativeOptions = nativePieces.map((p) => ({
    value: `native:${p.name}`,
    label: `${chalk.cyan(p.name)} ${chalk.dim('(native)')}`,
    hint: p.file.replace(cwd + '/', ''),
  }));

  // ── 3. Initial multi-select: native pieces ───────────────────────────────
  let selectedValues: string[] = [];

  if (nativeOptions.length > 0) {
    const initialSelected = nativeOptions
      .filter((o) => currentSymbols.some((s) => s.toLowerCase().includes(o.value.replace('native:', ''))))
      .map((o) => o.value);

    const nativeAnswer = await multiselect({
      message: 'Select native pieces to deploy (space = toggle, enter = confirm):',
      options: nativeOptions,
      initialValues: initialSelected,
      required: false,
    });

    if (isCancel(nativeAnswer)) {
      cancel('Cancelled');
      return;
    }

    selectedValues = nativeAnswer as string[];
  } else {
    log.warn('No native pieces found in src/pieces/');
  }

  // ── 4. npm search ────────────────────────────────────────────────────────
  const doSearch = await confirm({
    message: 'Search npm for @activepieces/piece-* packages to add?',
    initialValue: true,
  });

  if (!isCancel(doSearch) && doSearch) {
    let keepSearching = true;

    while (keepSearching) {
      const queryAnswer = await text({
        message: 'Search query (e.g. "gmail", "slack", leave blank for all):',
        placeholder: 'gmail',
      });

      if (isCancel(queryAnswer)) break;

      const spinner = ora('Searching npm…').start();
      let npmResults: NpmPackageInfo[] = [];
      try {
        npmResults = await searchNpmPieces((queryAnswer as string).trim());
        spinner.succeed(`Found ${npmResults.length} package(s)`);
      } catch (err) {
        spinner.fail(String(err));
      }

      if (npmResults.length > 0) {
        const npmOptions = npmResults.map((p) => ({
          value: `npm:${p.name}`,
          label: `${chalk.yellow(p.name)}${chalk.dim('@' + (p.version ?? 'latest'))}`,
          hint: (p.description ?? '').slice(0, 55),
        }));

        const alreadyInstalled = npmOptions
          .filter((o) => {
            const pieceName = o.value.replace('npm:@activepieces/piece-', '');
            return existsSync(join(cwd, 'src', 'pieces', `npm-${pieceName}.ts`));
          })
          .map((o) => o.value);

        const npmAnswer = await multiselect({
          message: 'Select npm pieces to install:',
          options: npmOptions,
          initialValues: alreadyInstalled,
          required: false,
        });

        if (!isCancel(npmAnswer)) {
          selectedValues = [...selectedValues, ...(npmAnswer as string[])];
        }
      } else {
        log.warn('No packages found for that query.');
      }

      const searchMore = await confirm({
        message: 'Search for more npm packages?',
        initialValue: false,
      });
      if (isCancel(searchMore) || !searchMore) keepSearching = false;
    }
  }

  // ── 5. Deduplicate selection ─────────────────────────────────────────────
  const unique = [...new Set(selectedValues)];

  if (unique.length === 0) {
    log.warn('No pieces selected.');
    outro('Nothing to do.');
    return;
  }

  // Summary
  const nativeSel = unique.filter((v) => v.startsWith('native:')).map((v) => v.replace('native:', ''));
  const npmSel = unique.filter((v) => v.startsWith('npm:')).map((v) => v.replace('npm:', ''));

  note(
    [
      nativeSel.length ? `Native:  ${chalk.cyan(nativeSel.join(', '))}` : '',
      npmSel.length ? `npm:     ${chalk.yellow(npmSel.join(', '))}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    'Selected pieces',
  );

  const proceed = await confirm({ message: 'Apply selection and deploy?', initialValue: true });
  if (isCancel(proceed) || !proceed) {
    outro('Cancelled.');
    return;
  }

  // ── 6. Install npm packages ──────────────────────────────────────────────
  const s = clackSpinner();

  for (const npmPkg of npmSel) {
    const pieceName = npmPkg.replace('@activepieces/piece-', '');
    const wrapperPath = join(cwd, 'src', 'pieces', `npm-${pieceName}.ts`);

    if (!existsSync(wrapperPath)) {
      s.start(`Installing ${npmPkg}…`);
      debug('tui', `npm install ${npmPkg}`);
      const result = spawnSync('npm', ['install', npmPkg], { cwd, encoding: 'utf-8', stdio: 'pipe' });
      if (result.error || result.status !== 0) {
        s.stop(`[E004] Failed to install ${npmPkg} — check network / registry access.`);
        if (result.stderr) process.stderr.write(result.stderr + '\n');
        continue;
      }
      s.stop(`Installed ${npmPkg}`);

      // Generate wrapper
      const symbol = toPieceSymbol(pieceName);
      const wrapper = generateWrapper(npmPkg, pieceName, symbol, '');
      await writeFile(wrapperPath, wrapper, 'utf-8');
      log.success(`Created wrapper: src/pieces/npm-${pieceName}.ts`);
    }
  }

  // ── 7. Update worker.ts marker blocks ───────────────────────────────────
  const pieces: PieceCodeEntry[] = [
    ...nativeSel.map((name) => ({
      symbol: toPieceSymbol(name) + 'Piece',
      importPath: `./pieces/${name}.js`,
    })),
    ...npmSel.map((pkg) => {
      const pieceName = pkg.replace('@activepieces/piece-', '');
      return {
        symbol: toPieceSymbol(pieceName) + 'Piece',
        importPath: `./pieces/npm-${pieceName}.js`,
      };
    }),
  ];

  s.start('Updating worker.ts…');
  try {
    await syncWorkerPieces(workerPath, pieces);
    s.stop('worker.ts updated');
  } catch (err) {
    s.stop(`Failed to update worker.ts: ${String(err)}`);
  }

  // ── 8. Deploy ────────────────────────────────────────────────────────────
  const doDeploy = await confirm({ message: 'Deploy now?', initialValue: true });

  if (!isCancel(doDeploy) && doDeploy) {
    if (existsSync(join(cwd, 'vite.config.admin.ts'))) {
      s.start('Building admin SPA…');
      debug('tui', 'npm run build:admin');
      const buildResult = spawnSync('npm', ['run', 'build:admin'], { cwd, encoding: 'utf-8', stdio: 'pipe' });
      if (buildResult.error || buildResult.status !== 0) {
        s.stop('Admin build failed (continuing)');
        debug('tui', buildResult.stderr ?? '');
      } else {
        s.stop('Admin SPA built');
      }
    }

    s.start('Deploying to Cloudflare…');
    debug('tui', 'npx wrangler deploy');
    const deployResult = spawnSync('npx', ['wrangler', 'deploy'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (deployResult.error || deployResult.status !== 0) {
      s.stop('[E005] Deployment failed');
      if (deployResult.stderr) process.stderr.write(deployResult.stderr + '\n');
      log.error('Run `npx wrangler deploy` manually to see full error output.');
    } else {
      s.stop('Deployed!');
      const urlMatch = (deployResult.stdout ?? '').match(/https:\/\/[a-z0-9-]+\.workers\.dev/);
      if (urlMatch) log.success(`Live: ${chalk.cyan(urlMatch[0])}`);
    }
  }

  outro('Done!');
}
