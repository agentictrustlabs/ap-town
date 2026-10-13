// STEPPING INTO A TAB — the operations centre's tabs are long pages, and a long page with no map is a scroll.
//
// The rail is DERIVED from the headings each tab already renders (`SectionHead` → `h2`), not from a list kept
// beside them: a tab that gains a section gains a rail entry on the same commit, and a list maintained by hand
// would be wrong the first time somebody added one. Headings without an `id` are given a slug here so the anchor
// has something to point at — the markup stays each tab's own.
//
// It observes which section is in view and marks it. Nothing here reads data or decides anything; it is a map of
// the page the reader is already on.
import { useEffect, useState, type ReactNode, type RefObject } from 'react';

export interface RailItem { id: string; label: string }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/** The headings in `root`, each given an id if it has none. Re-read whenever `key` changes (tab, window, data). */
export function useSections(root: RefObject<HTMLElement | null>, key: string): RailItem[] {
  const [items, setItems] = useState<RailItem[]>([]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // The tab's content arrives with its data, so look again on the next frames rather than once on mount — a
    // rail built before the sections exist is an empty rail that never fills.
    let timer: ReturnType<typeof setTimeout>;
    const read = (): void => {
      const heads = [...el.querySelectorAll('h2')];
      const seen = new Set<string>();
      const next: RailItem[] = [];
      for (const h of heads) {
        const label = (h.textContent ?? '').trim();
        if (!label) continue;
        let id = h.id || slug(label);
        while (seen.has(id)) id = `${id}-2`;
        seen.add(id);
        if (!h.id) h.id = id;
        next.push({ id, label });
      }
      setItems((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i]!.id && p.label === next[i]!.label) ? prev : next));
    };
    read();
    timer = setTimeout(read, 400);
    const t2 = setTimeout(read, 1600);
    return () => { clearTimeout(timer); clearTimeout(t2); };
  }, [root, key]);
  return items;
}

/** Which of `ids` is the one being read — the topmost heading that has passed the top of the viewport. */
function useCurrent(ids: string[]): string | null {
  const [cur, setCur] = useState<string | null>(null);
  useEffect(() => {
    if (!ids.length) return;
    const onScroll = (): void => {
      let best: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 120) best = id; else break;
      }
      setCur(best ?? ids[0]!);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ids.join('|')]);
  return cur;
}

export function SectionRail({ items, label }: { items: RailItem[]; label: string }): ReactNode {
  const cur = useCurrent(items.map((i) => i.id));
  if (items.length < 2) return null; // one section is not a map
  return (
    <nav className="srail" aria-label={`Sections of ${label}`}>
      <p className="srail-head">On this page</p>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={i.id === cur ? 'is-on' : undefined}
              onClick={(e) => { e.preventDefault(); const el = document.getElementById(i.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#${i.id}`); } }}>
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
