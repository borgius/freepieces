import chalk from 'chalk';
import ora from 'ora';
import { searchNpmPieces } from '../util/npm-registry.js';

export async function searchCommand(query?: string): Promise<void> {
  const q = (query ?? '').trim();
  const label = q ? `@activepieces/piece-${q.replace(/^@activepieces\/piece-/i, '')}` : '@activepieces/piece-*';
  const spinner = ora(`Searching npm for ${chalk.cyan(label)}…`).start();

  let results;
  try {
    results = await searchNpmPieces(q);
    spinner.succeed(`Found ${results.length} package(s)`);
  } catch (err) {
    spinner.fail(String(err));
    process.exit(1);
  }

  if (results.length === 0) {
    console.log(chalk.yellow('No packages found.'));
    return;
  }

  const nameW = Math.max(8, ...results.map((r) => r.name.length));
  const versionW = 9;

  // Table header
  console.log(
    '\n' +
      chalk.bold(
        `${'Name'.padEnd(nameW + 2)}${'Version'.padEnd(versionW + 2)}Description`,
      ),
  );
  console.log('─'.repeat(nameW + versionW + 42));

  for (const p of results) {
    const name = chalk.cyan(p.name.padEnd(nameW + 2));
    const ver = chalk.dim((p.version ?? '').padEnd(versionW + 2));
    const desc = (p.description ?? '').slice(0, 60);
    console.log(`${name}${ver}${desc}`);
  }

  console.log(
    `\n${chalk.dim('Install a piece:')}  ${chalk.green('fp install @activepieces/piece-NAME')}\n`,
  );
}
