// EVERY MCP SERVER IN THE TOWN — spec 435 §5, at the three scales anybody can check.
//
// The three answers come from three different places, which is the reason this page has three sections rather
// than one list:
//
//   THE TOWN'S    declared in the manifest, by the service that runs each one.
//   EACH ESTATE'S declared in the manifest, by the estate.
//   EACH AGENT'S  on the CHAIN — `atl:mcpEndpoint` on the agent's own name record.
//
// AND WHAT IS NOT HERE. Which MCP servers an agent has ATTACHED — the connectors its owner equipped it with
// (spec 404) — are records in HER vault under HER grant. The town cannot read them, and a page that listed the
// town's servers under an agent's name would be asserting something nobody said. The absence is stated on the
// page rather than left for a reader to mistake for "none".
import type { ReactNode } from 'react';
import { Chip, Empty, Link, Loading, SectionHead, Stat, useApi } from '@ap-town/town-ui';
import type { McpCensus, TownData } from '../types';
import { McpList } from './McpList';

export function Mcp({ t }: { t: TownData }): ReactNode {
  const v = useApi<McpCensus>('/api/mcp');
  return (
    <Loading v={v} what="Reading the town's MCP servers">{(d) => {
      const townServers = d.servers.filter((m) => m.scale === 'town');
      const doors = 'rows' in d.agentDoors ? d.agentDoors : null;
      return (
        <>
          <section className="title">
            <div>
              <h1>MCP servers</h1>
              <p className="lede">
                Which MCP servers this town runs, which each estate runs, and which agents serve a door of their own.
                MCP is a private capability interface behind an admitted runtime, so most of these have no door at all
                and the ones that do admit only an authenticated principal. An endpoint is where a server listens; it
                is never a statement that you may use it.
              </p>
            </div>
          </section>

          <section>
            <div className="stats">
              <Stat label="The town's" value={townServers.length} />
              {t.estates.map((e) => (
                <Stat key={e.id} label={`${e.id}'s`} value={d.servers.filter((m) => m.estate === e.id).length} />
              ))}
              <Stat label="Agents with a door" value={doors ? doors.rows.length : null} absent="the registry could not be asked" sub="their own, on chain" />
            </div>
          </section>

          <McpList servers={townServers} eyebrow="Declared by the town" title="The town's MCP servers">
            Shared by every estate. Two of them have no door at all: they are reached only over a Cloudflare service
            binding by the Workers the manifest names, which is why they can trust their caller.
          </McpList>

          {t.estates.map((e) => (
            <McpList
              key={e.id}
              servers={d.servers.filter((m) => m.estate === e.id)}
              eyebrow={`Declared by ${e.id}`}
              title={`${e.id}'s MCP servers`}
            >
              Run by this estate for its own people and agents. <Link href={`/estate/${e.id}`}>The {e.id} estate &rarr;</Link>
            </McpList>
          ))}

          <section>
            <SectionHead eyebrow="From the chain, not from this file" title="Agents that serve a door of their own">
              An agent whose name record carries an MCP endpoint serves tools behind its own door. This is read from
              the chain, so anybody with an RPC can reproduce it &mdash; and it says nothing about which tools, or
              about who may call them.
            </SectionHead>
            {!doors ? (
              <Empty title="The registry could not be asked just now.">
                {(d.agentDoors as { unavailable: string }).unavailable}
              </Empty>
            ) : doors.rows.length === 0 ? (
              <Empty title="No agent in this town publishes an MCP endpoint.">
                {doors.read} agent(s) were read and none of their name records carries one. An agent can serve tools
                without publishing a door &mdash; a service reached only by its own estate&rsquo;s Workers has nothing to
                publish &mdash; so this is a count of published doors, not of servers.
              </Empty>
            ) : (
              <ul className="plain">
                {doors.rows.map((a) => (
                  <li key={a.smartAgent}>
                    <Link href={`/agent/${encodeURIComponent(a.name ?? a.smartAgent)}`}>{a.name ?? a.displayName ?? a.smartAgent}</Link>
                    {a.estate ? <span className="quiet"> · {a.estate}</span> : <span className="quiet"> · estate not inferred</span>}
                    {' '}<span className="mono break">{a.mcpEndpoint}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="quiet">
              <strong>What an agent has ATTACHED is not here.</strong> The MCP servers an owner equipped her agent with
              are records in her vault, under her own grant (spec 404, ADR-0025). The town cannot read them and does
              not guess: a page that listed these servers under her agent&rsquo;s name would be asserting something she
              never said. Her Home is where that list lives. <Chip tone="muted">by design</Chip>
            </p>
          </section>
        </>
      );
    }}</Loading>
  );
}
