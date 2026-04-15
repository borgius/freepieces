import type { DocEntry, DocMeta, DocModule, DocSection } from './types';

const docLoaders = import.meta.glob('../../../docs/*.mdx') as Record<string, () => Promise<DocModule>>;
const docMetas = import.meta.glob('../../../docs/*.mdx', {
  eager: true,
  import: 'meta',
}) as Record<string, DocMeta>;

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    title: 'Get started',
    description: 'Bootstrap the repo, run locally, and get to a working smoke test fast.',
  },
  {
    id: 'architecture',
    title: 'Architecture',
    description: 'Understand pieces, registration, and the runtime surface area.',
  },
  {
    id: 'runtime',
    title: 'Runtime flows',
    description: 'Learn how actions, webhook subscriptions, queues, and polling work.',
  },
];

export const DOCS: DocEntry[] = Object.entries(docMetas)
  .map(([path, meta]) => ({
    meta,
    load: docLoaders[path],
  }))
  .filter((doc): doc is DocEntry => typeof doc.load === 'function')
  .sort((left, right) => left.meta.order - right.meta.order);

const docsBySlug = new Map(DOCS.map((doc) => [doc.meta.slug, doc]));

export function getDocBySlug(slug: string): DocEntry | undefined {
  return docsBySlug.get(slug);
}
