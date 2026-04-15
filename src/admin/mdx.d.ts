interface MdxDocMeta {
  slug: string;
  title: string;
  summary: string;
  section: 'getting-started' | 'architecture' | 'runtime';
  order: number;
  estimatedTime: string;
}

declare module '*.mdx' {
  export const meta: MdxDocMeta;

  const MDXContent: import('react').ComponentType<{
    components?: Record<string, unknown>;
  }>;
  export default MDXContent;
}
