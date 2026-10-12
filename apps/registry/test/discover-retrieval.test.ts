// THE WORDS HAVE TO REACH THE KNOWLEDGE BASE — the defect of 2026-10-12.
//
// `/discover` with an intent and no `query` fetches a BROAD page and ranks it, which is right: a need is a
// description, not a filter. But the page is capped and the base is bigger than the cap (305 agents to a
// 100-row page), and the page is not ordered by relevance — so an agent whose NAME was the question was never
// scored at all. `find?q=imb-estate&type=workspace` ranked eleven workspaces and not `imb-estate.workspace`.
//
// The fix is retrieval, not ranking: the words get a second NARROW read (the KB's own substring filter) whose
// rows are merged into the page. Nothing is filtered out and nothing is reordered — what the question named
// can simply no longer be absent. These tests hold that line from both sides.
import { describe, it, expect, afterEach, vi } from 'vitest';
import app from '../src/index.js';

const sa = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const agent = (name: string, n: number) => ({ agent: `urn:${name}`, name, smartAgent: sa(n), facets: ['naming'], shaclConforms: true, agentType: name.split('.')[1], tld: name.split('.')[1] });

/** A base of 103 agents whose 100-row page cannot reach the one the question names. */
const BASE = [...Array.from({ length: 100 }, (_, i) => agent(`filler-${String(i).padStart(3, '0')}.workspace`, i + 1)), agent('imb-estate.workspace', 901), agent('imbrichgoogle.me', 902), agent('zz-last.org', 903)];

const env = { MCP_URL: 'http://mcp.test', A2A_PUBLIC_ORIGIN: 'https://discovery-a2a.example' } as unknown as Parameters<typeof app.fetch>[1];
const discover = (body: unknown) => app.fetch(new Request('https://discovery-a2a.example/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);

/** The MCP as it actually behaves: `q` is a substring filter over the row text, `limit` truncates, and the
 *  truncation is REPORTED. Every read is recorded so a test can assert how many the fix costs. */
let reads: string[] = [];
const stubMcp = () => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const u = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  reads.push(u);
  if (!u.includes('/search')) return new Response('{}', { status: 404 });
  const url = new URL(u);
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const limit = Number(url.searchParams.get('limit') ?? 25);
  const hits = q ? BASE.filter((a) => a.name.toLowerCase().includes(q)) : BASE;
  return new Response(JSON.stringify({ ok: true, results: hits.slice(0, limit), truncated: hits.length > limit, limit, returned: Math.min(hits.length, limit) }), { headers: { 'content-type': 'application/json' } });
}));

describe('discovery retrieval sees what the question named (2026-10-12)', () => {
  afterEach(() => { vi.unstubAllGlobals(); reads = []; });

  it('ranks the agent the question NAMED first, though the broad page could never reach it', async () => {
    stubMcp();
    const j = await (await discover({ intent: { need: 'imb-estate' }, mandates: { requireAgentType: 'workspace' } })).json() as { results: Array<{ name: string }>; page: { returned: number; truncated: boolean; named: number } };
    expect(j.results[0]!.name).toBe('imb-estate.workspace');
    // The narrow read ADDED it; the broad page's 100 rows are all still there to be ranked.
    expect(j.page).toMatchObject({ returned: 100, truncated: true, named: 1 });
  });

  it('says what it read, so "nothing matched" is never confused with "the page did not reach it"', async () => {
    stubMcp();
    const j = await (await discover({ intent: { need: 'imb-estate' } })).json() as { page: { limit: number; returned: number; truncated: boolean } };
    expect(j.page).toMatchObject({ limit: 100, returned: 100, truncated: true });
  });

  it('a need that names nothing in the base adds nothing, and the ranking is untouched', async () => {
    stubMcp();
    const j = await (await discover({ intent: { need: 'a translation service for scripture' } })).json() as { results: Array<{ name: string }>; page: { named: number } };
    expect(j.page.named).toBe(0);
    expect(j.results).toHaveLength(100);
  });

  it('costs at most three extra bounded reads, phrase and identifier-shaped tokens only', async () => {
    stubMcp();
    await discover({ intent: { need: 'imb-estate or zz-last' } });
    const searches = reads.filter((u) => u.includes('/search'));
    expect(searches).toHaveLength(4);                                  // the broad page + three
    expect(searches.filter((u) => u.includes('limit=25'))).toHaveLength(3);
    expect(searches.some((u) => u.includes('q=or'))).toBe(false);      // "or" is too short to be a name
  });

  it('an explicit `query` is still the caller asking for a FILTER, with no second read', async () => {
    stubMcp();
    const j = await (await discover({ query: 'imb' })).json() as { results: Array<{ name: string }>; page: { named: number } };
    expect(j.results.map((r) => r.name)).toEqual(['imb-estate.workspace', 'imbrichgoogle.me']);
    expect(j.page.named).toBe(0);
    expect(reads.filter((u) => u.includes('/search'))).toHaveLength(1);
  });

  it('a failed narrow read costs the ranking nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (new URL(u).searchParams.get('q')) throw new Error('graphdb said no');
      return new Response(JSON.stringify({ ok: true, results: BASE.slice(0, 100), truncated: true, limit: 100 }), { headers: { 'content-type': 'application/json' } });
    }));
    const j = await (await discover({ intent: { need: 'imb-estate' } })).json() as { ok: boolean; results: unknown[]; page: { named: number } };
    expect(j.ok).toBe(true);
    expect(j.results).toHaveLength(100);
    expect(j.page.named).toBe(0);
  });
});
