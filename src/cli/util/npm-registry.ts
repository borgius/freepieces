export interface NpmPackageInfo {
  name: string;
  version: string;
  description: string;
  links?: { npm?: string };
}

interface NpmSearchResponse {
  objects: Array<{ package: NpmPackageInfo }>;
  total: number;
}

/**
 * Search the npm registry for @activepieces/piece-* packages.
 * If query is empty, lists all activepieces pieces.
 */
export async function searchNpmPieces(query: string): Promise<NpmPackageInfo[]> {
  const term = query
    ? `@activepieces/piece-${query.replace(/^@activepieces\/piece-/i, '')}`
    : '@activepieces/piece-';
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(term)}&size=25`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
  const data = (await res.json()) as NpmSearchResponse;
  return data.objects
    .map((o) => o.package)
    .filter((p) => p.name.includes('activepieces'));
}

/** Fetch package metadata from the npm registry. */
export async function getNpmPackageInfo(packageName: string): Promise<NpmPackageInfo> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Package ${packageName} not found on npm (${res.status})`);
  return (await res.json()) as NpmPackageInfo;
}
