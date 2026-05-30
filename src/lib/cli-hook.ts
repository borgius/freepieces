/**
 * CLI hook executor.
 *
 * Runs a configured command when a webhook subscription matches, passing the
 * (optionally jq-transformed) event payload on stdin as JSON. This is only
 * supported on the self-hosted Node.js runtime — the Cloudflare Workers runtime
 * cannot spawn processes, so callers must guard with `isNodeRuntime()` before
 * invoking `runCliHook`.
 *
 * Security: the command is run with `shell: false` and an explicit argument
 * array, so no shell interpolation/word-splitting occurs. Output is capped and
 * the process is killed after a timeout.
 */

/** Default per-invocation timeout. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Hard cap on captured stdout/stderr to avoid unbounded memory growth. */
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

/**
 * True when running on a Node.js runtime that can spawn child processes.
 * False on Cloudflare Workers (workerd) and other non-Node runtimes.
 */
export function isNodeRuntime(): boolean {
  // workerd exposes navigator.userAgent === 'Cloudflare-Workers'.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  if (ua && ua.includes('Cloudflare')) return false;
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

export interface CliHookOptions {
  /** Executable to run (resolved from PATH or an absolute path). */
  command: string;
  /** Arguments passed verbatim (no shell parsing). */
  args?: string[];
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
  /** Extra environment variables merged over the parent environment. */
  env?: Record<string, string>;
  /** Data written to the child's stdin (typically the JSON payload). */
  stdin?: string;
  /** Cap on captured stdout/stderr bytes. */
  maxOutputBytes?: number;
}

export interface CliHookResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn `command` with the given options and resolve with its result.
 * Rejects only when the process cannot be spawned at all.
 */
export async function runCliHook(opts: CliHookOptions): Promise<CliHookResult> {
  if (!isNodeRuntime()) {
    throw new Error('CLI hooks are only supported on the Node.js runtime');
  }

  const { spawn } = await import('node:child_process');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<CliHookResult>((resolve, reject) => {
    const child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      shell: false,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutputBytes) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutputBytes) stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.slice(0, maxOutputBytes),
        stderr: stderr.slice(0, maxOutputBytes),
        timedOut,
      });
    });

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    } else {
      child.stdin?.end();
    }
  });
}
