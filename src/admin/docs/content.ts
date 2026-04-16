import type { DocEntry, DocMeta, DocModule, DocSection } from './types';

const docModules = import.meta.glob('../../../docs/*.mdx', { eager: true }) as Record<
  string,
  DocModule & { meta: DocMeta }
>;

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

export const DOCS: DocEntry[] = Object.entries(docModules)
  .filter(([, mod]) => mod?.meta != null)
  .map(([, mod]) => ({
    meta: mod.meta,
    load: () => Promise.resolve(mod),
  }))
  .sort((left, right) => left.meta.order - right.meta.order);

const docsBySlug = new Map(DOCS.map((doc) => [doc.meta.slug, doc]));

export function getDocBySlug(slug: string): DocEntry | undefined {
  return docsBySlug.get(slug);
}
