// Hand-written types for the native cloudflare-r2 piece.

export interface CloudflareR2BindingInput {
  /** Worker R2 binding name. Defaults to BUCKET. */
  bucketBinding?: string;
}

export interface CloudflareR2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: string;
  httpMetadata?: unknown;
  customMetadata?: Record<string, string>;
  storageClass: string;
}

export interface CloudflareR2PutObjectInput extends CloudflareR2BindingInput {
  key: string;
  value?: string | null;
  contentType?: string;
  customMetadata?: Record<string, string>;
}

export interface CloudflareR2GetObjectInput extends CloudflareR2BindingInput {
  key: string;
  /** text or json. Defaults to text. */
  format?: 'text' | 'json';
}

export interface CloudflareR2DeleteObjectInput extends CloudflareR2BindingInput {
  key: string;
}

export interface CloudflareR2ListObjectsInput extends CloudflareR2BindingInput {
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  limit?: number;
}

export interface CloudflareR2PutObjectOutput {
  object: CloudflareR2Object | null;
}

export interface CloudflareR2GetObjectOutput<T = string | unknown> {
  found: boolean;
  object: CloudflareR2Object | null;
  value: T | null;
}

export interface CloudflareR2DeleteObjectOutput {
  deleted: true;
}

export interface CloudflareR2ListObjectsOutput {
  objects: Array<CloudflareR2Object | null>;
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface CloudflareR2Client {
  /** Store a string or null object in R2. */
  put_object(input: CloudflareR2PutObjectInput): Promise<CloudflareR2PutObjectOutput>;
  /** Fetch an R2 object and return its text or JSON value. */
  get_object<T = string | unknown>(input: CloudflareR2GetObjectInput): Promise<CloudflareR2GetObjectOutput<T>>;
  /** Delete an R2 object by key. */
  delete_object(input: CloudflareR2DeleteObjectInput): Promise<CloudflareR2DeleteObjectOutput>;
  /** List R2 objects with optional prefix, cursor, delimiter, and limit. */
  list_objects(input?: CloudflareR2ListObjectsInput): Promise<CloudflareR2ListObjectsOutput>;
}
