// ONE ESTATE, ON ITS OWN PAGE — spec 435 §4.
//
// An estate had no page. It had a card on the Pulse's Estates tab, which is the right place for its heartbeat
// and the wrong place for everything else about it: where it lives, which names it may give, whose keys hold
// its agents, which MCP servers it runs, which agents are its. Those are not operations questions, and an
// operator tab is where a reader looking for them never goes.
//
// TWO RULES THE PAGE KEEPS.
//
//   MEMBERSHIP IS INFERRED, AND SAYS SO ON EVERY ROW. §4's top rung — a live `TownStanding` naming the estate
//   — does not exist yet, so every agent here was placed by comparing its own on-chain endpoint against the
//   hosts this town declares. The word "inferred" is on the row, not in a footnote, and nothing promotes it.
//
//   NOT ASKED AND NOTHING ARE DIFFERENT ANSWERS. If the registry cannot be reached, the page says that. An
//   estate rendered with an empty roster because a service binding was down is the most convincing lie this
//   page could tell.
import type { ReactNode } from 'react';
import { Chip, Empty, Link, Loading, SectionHead, Stat, useApi } from '@ap-town/town-ui';
import type { EstateDetail, PlacedAgentRow, TownData } from '../types';
import { Ask } from '../pulse/Ask';
import { McpList } from './McpList';

const repoUrl = (repo: string): string => (repo === 'ap-town' ? 'https://github.com/agentictrustlabs/ap-town' : `https://github.com/${repo}`);

const HOW_WORDS: Record<PlacedAgentRow['how'], string> = {
  'agent-zone': 'its endpoint is under this estate’s agent zone',
  'estate-a2a': 'its endpoint is this estate’s own A2A host',
  unplaced: 'not placed',
};

/** The agents, grouped by the ADR-0046 class. `undeclared` is its own group: an agent that declared no type is
 *  a real state on the chain, and folding it into "service" would be the town inventing a fact. */
const GROUPS: Array<[key: 'person' | 'org' | 'service' | 'undeclared', label: string]> = [
  ['person', 'People'], ['org', 'Organizations'], ['service', 'Services'], ['undeclared', 'Type undeclared'],
];
const CLASS_OF: Record<string, 'person' | 'org' | 'service'> = {
  PersonAgent: 'person', OrganizationAgent: 'org', ServiceAgent: 'service', person: 'person', org: 'org', service: 'service',
};
const classOf = (a: PlacedAgentRow): 'person' | 'org' | 'service' | 'undeclared' =>
  (a.kind ? CLASS_OF[a.kind] : undefined) ?? (a.agentType ? CLASS_OF[a.agentType] : undefined) ?? 'undeclared';

function AgentRow({ a }: { a: PlacedAgentRow }): ReactNode {
  const label = a.name ?? a.displayName ?? a.smartAgent;
  return (
    <li>
      <Link href={`/agent/${encodeURIComponent(a.name ?? a.smartAgent)}`}>{label}</Link>
      {a.name && a.displayName ? <span className="quiet"> — {a.displayName}</span> : null}
      {a.mcpEndpoint ? <> <Chip tone="ok">serves MCP</Chip></> : null}
      <span className="quiet"> · {HOW_WORDS[a.how]}</span>
    </li>
  );
}

export function Estate({ t, id }: { t: TownData; id: string }): ReactNode {
  const v = useApi<EstateDetail>(`/api/estate/${encodeURIComponent(id)}`);
  const naming = t.services.find((s) => s.id === 'naming')?.hosts[0];
  return (
    <Loading v={v} what="Reading the estate">{(d) => {
      const e = d.estate;
      const roster = 'agents' in d.agents ? d.agents : null;
      return (
        <>
          <section className="title">
            <div>
              <h1>{e.id} <Chip tone="ok">estate</Chip></h1>
              <p className="lede">
                One Home, one gate, and the people and agents under it. Everything on this page is public: the
                town&rsquo;s manifest says what this estate declares, and the chain says which agents answer at its
                hosts. None of it says what anybody may do here &mdash; that is the estate&rsquo;s own Home to answer.
              </p>
              {e.estateName && (
                <p className="quiet">
                  Its own agent on this chain: <Link href={`/agent/${encodeURIComponent(e.estateName)}`}>{e.estateName}</Link>.
                  The name is stable; the Home&rsquo;s URL moves.
                </p>
              )}
            </div>
          </section>

          <Ask scope="estate" estates={[{ id: e.id }]} agents={d.agent ? { town: null, estates: { [e.id]: d.agent } } : undefined} />

          <section>
            <SectionHead eyebrow="From the town's manifest" title="Where it lives">
              The three doors an estate has, and the repository it is deployed from. A host here is where
              something listens; being able to reach it is not being admitted to it.
            </SectionHead>
            <dl className="kv kv-facts">
              <dt>Home</dt><dd><a href={e.home} rel="noreferrer" className="mono break">{e.home}</a></dd>
              <dt>Edge</dt><dd><a href={e.edge} rel="noreferrer" className="mono break">{e.edge}</a></dd>
              <dt>A2A</dt><dd><a href={e.a2a} rel="noreferrer" className="mono break">{e.a2a}</a></dd>
              <dt>Agent zone</dt>
              <dd>{e.agentZone
                ? <span className="mono">{e.agentZone}</span>
                : <span className="quiet">none — its agents are reached through its edge by name, which is the routing rule anyway: a name resolves to an endpoint from the chain, and a subdomain is never the authority</span>}</dd>
              <dt>Repository</dt><dd><a href={repoUrl(e.repo)} rel="noreferrer">{e.repo}</a></dd>
              <dt>Chain</dt><dd>{d.chain.id} · contracts generation {d.chain.generation}</dd>
            </dl>
          </section>

          <section>
            <SectionHead eyebrow="What it may name, and who holds its keys" title="Names and custody">
              Both of these are checkable without trusting this page. The gate&rsquo;s allowance is on chain, so a
              reader can recover a registration&rsquo;s signer and see it for themselves; the custody line says what
              is actually there rather than the most reassuring thing that could be written.
            </SectionHead>
            <dl className="kv kv-facts">
              <dt>Name roots</dt><dd>{e.nameRoots.map((r) => <span key={r} className="mono">.{r} </span>)}</dd>
              <dt>Naming gate</dt>
              <dd>{e.namingGate
                ? <>
                    <span className="mono break">{e.namingGate}</span>
                    <span className="quiet"> — the key whose signature authorizes a priced registration from this Home. Recover the signer from a registration and it is this address.</span>
                  </>
                : <span className="quiet">none — this estate has no gate of its own, so its names carry no estate signal and the naming service answers “no estate” for them rather than guessing one</span>}</dd>
              <dt>Key custody</dt>
              <dd>{e.kms
                ? e.kms.tenant
                  ? <>tenant <span className="mono">{e.kms.tenant}</span>{e.kms.backend ? <span className="quiet"> · {e.kms.backend}</span> : null}<span className="quiet"> — a key is a delegate, never an identity</span></>
                  : <span className="quiet">no tenant of its own{e.kms.backend ? ` — ${e.kms.backend}` : ''}</span>
                : <span className="quiet">not declared</span>}</dd>
              {naming && <><dt>Its names</dt><dd><a href={`https://${naming}`} rel="noreferrer">the town&rsquo;s naming service &rarr;</a></dd></>}
            </dl>
          </section>

          <McpList servers={d.mcpServers} eyebrow="Declared by this estate" title="Its MCP servers">
            The MCP servers this estate runs, as its manifest declares them &mdash; not read off Worker names, because
            a spelling convention is not a declaration. Each one&rsquo;s authorization decision is the chain, re-run
            server-side against the principal agent on every call; a token at the door is at most the envelope the
            request arrived in.
          </McpList>

          <section>
            <SectionHead eyebrow="Placed from their own on-chain endpoints" title="Its agents">
              Which agents answer at this estate&rsquo;s hosts. Every row here is an INFERENCE from the agent&rsquo;s
              own records and says which one: the attestation that would make this a settled fact does not exist yet,
              and an inference does not become one by being shown. Counts and names only &mdash; nothing from any vault.
            </SectionHead>
            {!roster ? (
              <Empty title="The registry could not be asked just now.">
                {(d.agents as { unavailable: string }).unavailable} An empty list would have looked exactly like this
                page working, which is why it is not shown.
              </Empty>
            ) : roster.agents.length === 0 ? (
              <Empty title="No agent was placed in this estate.">
                {roster.read} agent(s) were read from the registry and none of their endpoints matched this
                estate&rsquo;s hosts. That is a statement about endpoints, not about the estate: an agent whose records
                name no endpoint cannot be placed by anybody who only has its name.
              </Empty>
            ) : (
              <>
                <div className="stats">
                  <Stat label="People" value={roster.byKind.person} />
                  <Stat label="Organizations" value={roster.byKind.org} />
                  <Stat label="Services" value={roster.byKind.service} />
                  <Stat label="Type undeclared" value={roster.byKind.undeclared} sub="a real state on the chain" />
                  <Stat label="Serve an MCP door" value={roster.withMcp} sub="their own, on chain" />
                </div>
                <p className="quiet">
                  {roster.agents.length} placed, out of {roster.read} agent(s) read from the registry
                  {roster.truncated ? ' — and the registry holds more than one page, so this is a floor and not a total' : ''}.
                </p>
                {GROUPS.map(([key, label]) => {
                  const rows = roster.agents.filter((a) => classOf(a) === key);
                  if (rows.length === 0) return null;
                  return (
                    <div key={key}>
                      <h3>{label} <span className="quiet">{rows.length}</span></h3>
                      <ul className="plain">{rows.map((a) => <AgentRow key={a.smartAgent} a={a} />)}</ul>
                    </div>
                  );
                })}
              </>
            )}
          </section>

          <section>
            <SectionHead eyebrow="Spec 437 I4" title="What it runs">
              The platform resources the town attributes to this estate. This is what makes a cost figure
              attributable: a resource not declared under an estate is not in its half, and shows in the
              town&rsquo;s Unattributed bucket instead.
            </SectionHead>
            <dl className="kv kv-facts">
              {e.workers?.length ? <><dt>Workers</dt><dd>{e.workers.map((w) => <span key={w} className="mono">{w} </span>)}</dd></> : null}
              {e.vercelProjects?.length ? <><dt>Vercel projects</dt><dd>{e.vercelProjects.map((w) => <span key={w} className="mono">{w} </span>)}</dd></> : null}
              {e.pagesProjects?.length ? <><dt>Pages projects</dt><dd>{e.pagesProjects.map((w) => <span key={w} className="mono">{w} </span>)}</dd></> : null}
              {e.azureResources?.length ? <><dt>Azure resources</dt><dd>{e.azureResources.map((w) => <span key={w} className="mono break">{w} </span>)}</dd></> : null}
            </dl>
            <p className="quiet">
              Its heartbeat, run mix and cost are the Pulse&rsquo;s. <Link href="/operations/estates">See this estate on the Pulse &rarr;</Link>
            </p>
          </section>
        </>
      );
    }}</Loading>
  );
}
