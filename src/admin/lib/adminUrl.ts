export type Tab = 'pieces' | 'add-piece' | 'docs' | 'settings';
export type Section = 'secrets' | 'triggers' | 'test-events';

const VALID_TABS: Tab[] = ['pieces', 'add-piece', 'docs', 'settings'];
const VALID_SECTIONS: Section[] = ['secrets', 'triggers', 'test-events'];

export interface AdminNav {
  tab: Tab;
  section: Section;
  triggerId: string | undefined;
}

export function parseAdminUrl(): AdminNav {
  const path = window.location.pathname;
  // Strip /admin prefix and split into parts
  const rest = path.replace(/^\/admin\/?/, '');
  const parts = rest.split('/').filter(Boolean);

  const tabRaw = parts[0] ?? '';
  const tab: Tab = (VALID_TABS as string[]).includes(tabRaw) ? (tabRaw as Tab) : 'pieces';

  let section: Section = 'secrets';
  let triggerId: string | undefined;

  if (tab === 'settings') {
    const sectionRaw = parts[1] ?? 'secrets';
    section = (VALID_SECTIONS as string[]).includes(sectionRaw) ? (sectionRaw as Section) : 'secrets';
    if (section === 'triggers' && parts[2]) {
      triggerId = decodeURIComponent(parts[2]);
    }
  }

  return { tab, section, triggerId };
}

export function buildAdminUrl(tab: Tab, section?: Section, triggerId?: string): string {
  if (tab !== 'settings') return `/admin/${tab}/`;
  const sec = section ?? 'secrets';
  if (sec !== 'triggers' || !triggerId) return `/admin/settings/${sec}/`;
  return `/admin/settings/triggers/${encodeURIComponent(triggerId)}`;
}

export function pushAdminUrl(tab: Tab, section?: Section, triggerId?: string): void {
  const url = buildAdminUrl(tab, section, triggerId);
  window.history.pushState(null, '', url);
}
