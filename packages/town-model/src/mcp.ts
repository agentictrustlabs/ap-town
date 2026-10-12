// THE MCP CENSUS AT THREE SCALES — spec 435 §5, the part a manifest can answer.
//
// "Which MCP servers are here" is asked at three scales and the answer comes from a different place each
// time, which is the whole reason this file exists rather than one list:
//
//   TOWN     the services whose own interface is MCP          declared in town.yaml (`services[].mcp`)
//   ESTATE   the servers that estate runs                     declared in town.yaml (`estates[].mcpServers`)
//   AGENT    `atl:mcpEndpoint` on the agent's name record     ON CHAIN — not here, and not derivable here
//
// The agent scale is deliberately absent from this module. An agent's MCP door is a public on-chain record
// and the registry already answers for it; an agent's ATTACHED MCP servers (spec 404 `connector.mcp:<id>`)
// are records in its owner's vault under her grant, and the town cannot see them and must not guess. A page
// that listed a town's MCP servers under an agent's name would be saying something nobody asserted.
//
// NOTHING HERE IS AUTHORITY (spec 429 D2, ADR-0057). `exposure` says whether a door exists and who it
// admits. Whether a caller may use a tool is decided inside the server, against the chain, every call.
import type { TownManifest, TownMcpServer } from './types';

/** One census row, with the scale it was found at and where that scale's claim comes from. */
export interface McpServerView extends TownMcpServer {
  /** `town` — a service of the town; `estate` — run by one estate. */
  scale: 'town' | 'estate';
  /** The estate's id, for an estate-scale row. */
  estate?: string;
  /** The town service this row IS, when it is one — so a reader can open its page. */
  serviceId?: string;
}

/** The town's own MCP servers: every service whose interface IS MCP, plus every server a service runs
 *  beside its own interface. Both are the town's; the row says which service it belongs to either way. */
export function townMcpServers(town: TownManifest): McpServerView[] {
  const beside = town.services.flatMap((s) => (s.mcpServers ?? []).map((m) => ({ ...m, scale: 'town' as const, serviceId: s.id })));
  const own = town.services
    .filter((s) => !!s.mcp)
    .map((s) => ({
      scale: 'town' as const,
      serviceId: s.id,
      id: s.id,
      description: s.description,
      exposure: s.mcp!.exposure,
      // A `binding` server has no door by definition; a declared url on one would be a contradiction, so the
      // service's own first host is NOT silently borrowed here.
      ...(s.mcp!.url ? { url: s.mcp!.url } : s.mcp!.exposure !== 'binding' && s.hosts[0] ? { url: `https://${s.hosts[0]}` } : {}),
      ...(s.worker ? { worker: s.worker } : {}),
      ...(s.agentName ? { agentName: s.agentName } : {}),
      ...(s.probe ? { probe: s.probe } : {}),
    }));
  return [...own, ...beside];
}

/** One estate's declared MCP servers. An estate the town does not know returns nothing. */
export function estateMcpServers(town: TownManifest, estateId: string): McpServerView[] {
  const e = town.estates.find((x) => x.id === estateId);
  return (e?.mcpServers ?? []).map((m) => ({ ...m, scale: 'estate' as const, estate: estateId }));
}

/** Every MCP server the manifest declares, town first then estate by estate, in manifest order. */
export function allMcpServers(town: TownManifest): McpServerView[] {
  return [...townMcpServers(town), ...town.estates.flatMap((e) => estateMcpServers(town, e.id))];
}

/** How an exposure reads to somebody deciding whether they can call it. Words, never a badge colour. */
export const EXPOSURE_WORDS: Record<TownMcpServer['exposure'], string> = {
  binding: 'no door — only a Worker bound to it can reach it',
  authenticated: 'has a door; admits only an authenticated principal',
  open: 'has a door that answers an anonymous client, read-only',
};
