// The connected person, for every page (spec 431 §5.1). The estates come from `/api/health` — the Home doors the
// manifest names — so Connect and every hand-off know where to go without a constant in this bundle.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from './api';
import type { EstateRef } from './api-types';
import { connectAsPersona, connectViaHome, consumeConnectError, disconnect, getSession, listPersonas, listYourAgents, refreshSessionName, signOutEverywhere, type NamesSession, type Persona, type YourAgent } from './session';

export interface SessionState {
  readonly session: NamesSession | null;
  readonly estates: EstateRef[];
  /** A connect attempt in flight, with the Home's progress line. */
  readonly busy: string | null;
  /** The last failure, until the next attempt. */
  readonly error: string | null;
  connect(estate: EstateRef, returnPath: string): Promise<NamesSession | null>;
  connectAs(estate: EstateRef, handle: string): Promise<NamesSession | null>;
  personas(estate: EstateRef): Promise<Persona[]>;
  leave(everywhere?: boolean): void;
  /** The agents the connected person keeps, through their Home (W5c): null until read, [] when none. */
  readonly agents: YourAgent[] | null;
  readonly agentsError: string | null;
  refreshAgents(): void;
}

const Ctx = createContext<SessionState>({ session: null, estates: [], busy: null, error: null, connect: async () => null, connectAs: async () => null, personas: async () => [], leave: () => undefined, agents: null, agentsError: null, refreshAgents: () => undefined });
export const useSession = (): SessionState => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const health = useApi<{ town: string; estates?: EstateRef[] }>('/api/health');
  const estates = useMemo(() => (health.state === 'ready' ? health.data.estates ?? [] : []), [health]);
  const [session, setSession] = useState<NamesSession | null>(() => getSession());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => consumeConnectError());
  // The redirect leg lands with the session already stored (main.tsx finished it before rendering).
  useEffect(() => { setSession(getSession()); }, []);
  // Her agents, through her Home — read once per session and again whenever a ceremony lands.
  const [agents, setAgents] = useState<YourAgent[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsTick, setAgentsTick] = useState(0);
  const refreshAgents = useCallback(() => {
    setAgentsTick((n) => n + 1);
    // The person's own presented name may have changed too (their first purchase).
    const cur = getSession();
    if (cur) void refreshSessionName(cur).then((next) => { if (next.name !== cur.name) setSession(next); });
  }, []);
  useEffect(() => {
    if (!session) { setAgents(null); setAgentsError(null); return; }
    let live = true;
    listYourAgents(session).then((a) => { if (live) { setAgents(a); setAgentsError(null); } }, (e: unknown) => { if (live) { setAgents([]); setAgentsError(e instanceof Error ? e.message : String(e)); } });
    return () => { live = false; };
  }, [session, agentsTick]);

  const connect = useCallback(async (estate: EstateRef, returnPath: string) => {
    setError(null); setBusy('Opening your Home…');
    try {
      const s = await connectViaHome(estate, estates, returnPath, setBusy);
      if (s) setSession(s);
      return s;
    } catch (e) { setError(e instanceof Error ? e.message : 'the Home would not connect'); return null; } finally { setBusy(null); }
  }, [estates]);
  const connectAs = useCallback(async (estate: EstateRef, handle: string) => {
    setError(null); setBusy(`Connecting as ${handle}…`);
    try { const s = await connectAsPersona(estate, handle); setSession(s); return s; } catch (e) { setError(e instanceof Error ? e.message : 'the Home would not connect'); return null; } finally { setBusy(null); }
  }, []);
  const personas = useCallback((estate: EstateRef) => listPersonas(estate).catch(() => [] as Persona[]), []);
  const leave = useCallback((everywhere = false) => {
    if (everywhere && session) { signOutEverywhere(session); return; }
    disconnect(); setSession(null);
  }, [session]);

  const value = useMemo<SessionState>(() => ({ session, estates, busy, error, connect, connectAs, personas, leave, agents, agentsError, refreshAgents }), [session, estates, busy, error, connect, connectAs, personas, leave, agents, agentsError, refreshAgents]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
