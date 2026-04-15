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
  select,
} from '@clack/prompts';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { setWranglerSecret } from '../util/wrangler.js';

const SECRET_NAMES = [
  { value: 'RUN_API_KEY', label: 'RUN_API_KEY (shared runtime auth key, prefix with fp_sk_)' },
  { value: 'TOKEN_ENCRYPTION_KEY', label: 'TOKEN_ENCRYPTION_KEY (AES-GCM key, 32 hex bytes)' },
  { value: 'ADMIN_SIGNING_KEY', label: 'ADMIN_SIGNING_KEY (HMAC key, 32 hex bytes)' },
  { value: 'ADMIN_USER', label: 'ADMIN_USER' },
  { value: 'ADMIN_PASSWORD', label: 'ADMIN_PASSWORD' },
  { value: 'EXAMPLE_OAUTH_CLIENT_ID', label: 'EXAMPLE_OAUTH_CLIENT_ID' },
  { value: 'EXAMPLE_OAUTH_CLIENT_SECRET', label: 'EXAMPLE_OAUTH_CLIENT_SECRET' },
  { value: 'GMAIL_CLIENT_ID', label: 'GMAIL_CLIENT_ID' },
  { value: 'GMAIL_CLIENT_SECRET', label: 'GMAIL_CLIENT_SECRET' },
  { value: 'custom', label: 'Custom secret name…' },
] as const;

export async function configCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!existsSync(join(cwd, 'wrangler.toml'))) {
    console.error('No wrangler.toml found. Run `fp init` first or cd into your project.');
    process.exit(1);
  }

  intro(' freepieces config — manage Worker secrets ');

  note(
    'All values are stored as Cloudflare Worker Secrets (encrypted).\n' +
      'They are never written to disk in plaintext.',
    'Security',
  );

  let continueLoop = true;

  while (continueLoop) {
    const secretChoice = await select({
      message: 'Which secret do you want to set?',
      options: [...SECRET_NAMES],
    });

    if (isCancel(secretChoice)) {
      cancel('Config cancelled');
      break;
    }

    let secretName = secretChoice as string;

    if (secretName === 'custom') {
      const nameAnswer = await text({
        message: 'Secret name:',
        validate(v) {
          if (!v?.trim()) return 'Required';
          if (!/^[A-Z0-9_]+$/.test(v.trim()))
            return 'Secret names should be UPPER_SNAKE_CASE';
        },
      });
      if (isCancel(nameAnswer)) {
        cancel('Config cancelled');
        break;
      }
      secretName = (nameAnswer as string).trim();
    }

    const valueAnswer = await password({
      message: `Value for ${secretName}:`,
      validate(v) {
        if (!v?.trim()) return 'Required';
      },
    });

    if (isCancel(valueAnswer)) {
      cancel('Config cancelled');
      break;
    }

    const s = clackSpinner();
    s.start(`Setting ${secretName}…`);
    try {
      setWranglerSecret(secretName, valueAnswer as string, cwd);
      s.stop(`${secretName} set`);
    } catch (err) {
      s.stop(`Failed: ${String(err)}`);
    }

    const again = await confirm({ message: 'Set another secret?', initialValue: false });
    if (isCancel(again) || !again) continueLoop = false;
  }

  outro('Done. Run `fp deploy` to redeploy with updated secrets.');
}
