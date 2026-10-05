// A small router over the History API: real URLs, real links, back and forward work, a middle-click opens a tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

interface Route { path: string; search: string; go(href: string): void }
const Ctx = createContext<Route>({ path: '/', search: '', go: () => {} });

export function Router({ children }: { children: ReactNode }): ReactNode {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((href: string) => {
    if (/^https?:\/\//.test(href)) { window.location.href = href; return; }
    window.history.pushState(null, '', href);
    setLoc({ path: window.location.pathname, search: window.location.search });
    window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ ...loc, go }), [loc, go]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRoute = (): Route => useContext(Ctx);

export function Link({ href, children, className, title }: { href: string; children: ReactNode; className?: string; title?: string }): ReactNode {
  const { go } = useRoute();
  const external = /^https?:\/\//.test(href);
  const onClick = (e: MouseEvent) => { if (external || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(href); };
  return <a href={href} onClick={onClick} className={className} title={title} {...(external ? { rel: 'noreferrer' } : {})}>{children}</a>;
}

