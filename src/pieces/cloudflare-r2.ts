import { createPiece } from '../framework/piece';
import type { Env, PieceActionContext, PropDefinition } from '../framework/types';

const DEFAULT_R2_BINDING = 'BUCKET';

const bucketBindingProp: PropDefinition = {
  type: 'SHORT_TEXT',
  displayName: 'R2 binding name',
  description: `Worker binding name for the R2 bucket. Defaults to ${DEFAULT_R2_BINDING}.`,
  required: false,
  defaultValue: DEFAULT_R2_BINDING,
};

const keyProp: PropDefinition = {
  type: 'SHORT_TEXT',
  displayName: 'Object key',
  description: 'R2 object key.',
  required: true,
};

function getProps(ctx: PieceActionContext): Record<string, unknown> {
  return ctx.props ?? {};
}

function readString(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readOptionalString(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringMap(props: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const value = props[key];
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object`);

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, entryValue]) => typeof entryValue !== 'string')) {
    throw new Error(`${key} values must be strings`);
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function getR2Bucket(env: Env, props: Record<string, unknown>): R2Bucket {
  const bindingName = typeof props['bucketBinding'] === 'string' && props['bucketBinding'].trim()
    ? props['bucketBinding'].trim()
    : DEFAULT_R2_BINDING;
  const binding = env[bindingName];
  const bucket = binding as R2Bucket | undefined;
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function' || typeof bucket.list !== 'function') {
    throw new Error(`R2 binding "${bindingName}" was not found`);
  }
  return bucket;
}

function serializeObject(object: R2Object | null): Record<string, unknown> | null {
  if (!object) return null;
  return {
    key: object.key,
    version: object.version,
    size: object.size,
    etag: object.etag,
    httpEtag: object.httpEtag,
    uploaded: object.uploaded.toISOString(),
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
    storageClass: object.storageClass,
  };
}

async function putObject(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const bucket = getR2Bucket(ctx.env, props);
  const key = readString(props, 'key');
  const value = props['value'];
  if (value != null && typeof value !== 'string') throw new Error('value must be a string or null');

  const contentType = readOptionalString(props, 'contentType');
  const customMetadata = readStringMap(props, 'customMetadata');
  const object = await bucket.put(key, value ?? null, {
    ...(contentType ? { httpMetadata: { contentType } } : {}),
    ...(customMetadata ? { customMetadata } : {}),
  });
  return { object: serializeObject(object) };
}

async function getObject(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const bucket = getR2Bucket(ctx.env, props);
  const object = await bucket.get(readString(props, 'key'));
  if (!object) return { found: false, object: null, value: null };

  const format = readOptionalString(props, 'format') ?? 'text';
  const value = format === 'json' ? await object.json() : await object.text();
  return { found: true, object: serializeObject(object), value };
}

async function deleteObject(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const bucket = getR2Bucket(ctx.env, props);
  await bucket.delete(readString(props, 'key'));
  return { deleted: true };
}

async function listObjects(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const bucket = getR2Bucket(ctx.env, props);
  const limit = typeof props['limit'] === 'number'
    ? Math.min(Math.max(Math.trunc(props['limit']), 1), 1000)
    : undefined;
  const result = await bucket.list({
    ...(limit ? { limit } : {}),
    ...(readOptionalString(props, 'prefix') ? { prefix: readOptionalString(props, 'prefix') } : {}),
    ...(readOptionalString(props, 'cursor') ? { cursor: readOptionalString(props, 'cursor') } : {}),
    ...(readOptionalString(props, 'delimiter') ? { delimiter: readOptionalString(props, 'delimiter') } : {}),
  });

  return {
    objects: result.objects.map(serializeObject),
    truncated: result.truncated,
    cursor: result.truncated ? result.cursor : undefined,
    delimitedPrefixes: result.delimitedPrefixes,
  };
}

export const cloudflareR2Piece = createPiece({
  name: 'cloudflare-r2',
  displayName: 'Cloudflare R2',
  description: 'Read, write, delete, and list objects in a Cloudflare R2 binding.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [
    {
      name: 'put_object',
      displayName: 'Put Object',
      description: 'Store a string or null object in R2.',
      props: {
        bucketBinding: bucketBindingProp,
        key: keyProp,
        value: { type: 'LONG_TEXT', displayName: 'Value', required: false },
        contentType: { type: 'SHORT_TEXT', displayName: 'Content type', required: false },
        customMetadata: { type: 'JSON', displayName: 'Custom metadata', required: false },
      },
      run: putObject,
    },
    {
      name: 'get_object',
      displayName: 'Get Object',
      description: 'Fetch an R2 object and return its text or JSON value.',
      props: {
        bucketBinding: bucketBindingProp,
        key: keyProp,
        format: {
          type: 'SHORT_TEXT',
          displayName: 'Format',
          description: 'text or json. Defaults to text.',
          required: false,
          defaultValue: 'text',
        },
      },
      run: getObject,
    },
    {
      name: 'delete_object',
      displayName: 'Delete Object',
      description: 'Delete an R2 object by key.',
      props: { bucketBinding: bucketBindingProp, key: keyProp },
      run: deleteObject,
    },
    {
      name: 'list_objects',
      displayName: 'List Objects',
      description: 'List R2 objects with optional prefix, cursor, delimiter, and limit.',
      props: {
        bucketBinding: bucketBindingProp,
        prefix: { type: 'SHORT_TEXT', displayName: 'Prefix', required: false },
        cursor: { type: 'SHORT_TEXT', displayName: 'Cursor', required: false },
        delimiter: { type: 'SHORT_TEXT', displayName: 'Delimiter', required: false },
        limit: { type: 'NUMBER', displayName: 'Limit', required: false },
      },
      run: listObjects,
    },
  ],
});
