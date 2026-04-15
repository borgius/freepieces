import type { ComponentType } from 'react';

export type DocSectionId = 'getting-started' | 'architecture' | 'runtime';

export interface DocMeta {
  slug: string;
  title: string;
  summary: string;
  section: DocSectionId;
  order: number;
  estimatedTime: string;
}

export interface DocComponentProps {
  components?: Record<string, unknown>;
}

export interface DocModule {
  default: ComponentType<DocComponentProps>;
}

export interface DocEntry {
  meta: DocMeta;
  load: () => Promise<DocModule>;
}

export interface DocSection {
  id: DocSectionId;
  title: string;
  description: string;
}
