import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** Run a wrangler command synchronously and return stdout. */
export function runWranglerSync(args: string[], cwd: string): string {
  return execSync(`npx wrangler ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Run a wrangler command with an inherited stdio so the user can interact. */
export function runWranglerInteractive(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { cwd, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler exited with code ${code ?? 'null'}`));
    });
  });
}

/**
 * Create a KV namespace and return its ID.
 * If the namespace already exists, looks up its ID via `wrangler kv namespace list`.
 */
export async function createKVNamespace(name: string, cwd: string): Promise<string> {
  try {
    const output = runWranglerSync(['kv', 'namespace', 'create', name], cwd);
    const match = output.match(/id\s*=\s*"([a-f0-9]{32})"/);
    if (!match) throw new Error(`Could not parse KV namespace ID from wrangler output:\n${output}`);
    return match[1];
  } catch (err) {
    // If it already exists – look it up from the list
    if (String(err).includes('already exists')) {
      return lookupKVNamespace(name, cwd);
    }
    throw err;
  }
}

/** List KV namespaces and return the ID for `name`. */
function lookupKVNamespace(name: string, cwd: string): string {
  const output = runWranglerSync(['kv', 'namespace', 'list'], cwd);
  // wrangler outputs JSON, possibly with leading log lines – grab the JSON array
  const jsonMatch = output.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Cannot parse kv namespace list output:\n${output}`);
  const list = JSON.parse(jsonMatch[0]) as Array<{ title: string; id: string }>;
  const ns = list.find((n) => n.title === name);
  if (!ns) throw new Error(`KV namespace "${name}" not found in account`);
  return ns.id;
}

/** Set a Cloudflare Worker secret non-interactively. */
export function setWranglerSecret(name: string, value: string, cwd: string): void {
  execSync(`echo ${JSON.stringify(value)} | npx wrangler secret put ${name}`, {
    cwd,
    shell: '/bin/bash',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

/** Return true if wrangler is authenticated (wrangler whoami succeeds). */
export function isWranglerAuthed(cwd: string): boolean {
  try {
    runWranglerSync(['whoami'], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Generate N cryptographically-random hex bytes. */
export function generateHexSync(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
