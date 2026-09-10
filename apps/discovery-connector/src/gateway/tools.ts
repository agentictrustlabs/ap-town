// THE GATEWAY TOOLS (spec 387 §2): discover_agents (the registry search plus a signed handle per match),
// inspect_agent, invoke_agent, get_task. The host carries handles and task ids; the gateway holds nothing.
import { findServices, type FindServicesResult } from '../catalog.js';
import type { DiscoveryEnv } from '../ard-client.js';
import { mintHandle, verifyHandle, type HandlePayloadV1 } from './handle.js';
import { fetchCard, sendMessage, getTask, translateTask, type GatewayIdentity } from './a2a-client.js';
import { DISCOVERY_NOTE } from '../whitelabel.js';

export interface GatewayEnv extends DiscoveryEnv {
  HANDLE_SECRET?: string;
  GATEWAY_AGENT?: string;
  GATEWAY_PRIVATE_KEY?: string;
  GATEWAY_SESSION_WIRE?: string;
}

const GATEWAY_NOTE = 'The gateway acts as its own agent of the estate and spends no authority: a read or an informational skill answers; an act waits at the target for its stewards. Discovery authorizes nothing.';

function identityOf(env: GatewayEnv): GatewayIdentity | { refused: string } {
  if (!env.GATEWAY_AGENT || !env.GATEWAY_PRIVATE_KEY || !env.GATEWAY_SESSION_WIRE) return { refused: 'this gateway has no agent identity configured (GATEWAY_AGENT, GATEWAY_PRIVATE_KEY, GATEWAY_SESSION_WIRE) — it cannot speak to anyone as itself' };
  try {
    const wire = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(env.GATEWAY_SESSION_WIRE.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (env.GATEWAY_SESSION_WIRE.length % 4)) % 4)), (c) => c.charCodeAt(0))));
    return { agent: env.GATEWAY_AGENT, privateKey: env.GATEWAY_PRIVATE_KEY as `0x${string}`, wire };
  } catch { return { refused: 'the gateway\'s session wire is unreadable' }; }
}

/** The registry search of spec 386, each match carrying a handle bound to the card it names. */
export async function discoverAgents(env: GatewayEnv, args: { intent?: string; topic?: string; capability?: string; language?: string; limit?: number }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const found = await findServices(env, { ...(args.topic ? { topic: args.topic } : args.intent ? { topic: args.intent } : {}), ...(args.capability ? { capability: args.capability } : {}), ...(args.language ? { language: args.language } : {}), ...(args.limit ? { limit: args.limit } : {}) });
  if ('refused' in found) return found as unknown as Record<string, unknown>;
  if (!env.HANDLE_SECRET) return { ...found, note: `${found.note} No targets: this gateway has no handle secret configured.` };
  const registry = found.query.registry;
  const agents = await Promise.all((found as FindServicesResult).services.map(async (sv) => {
    if (!sv.card) return { ...sv, target: null, targetNote: 'no card to bind a handle to' };
    const c = await fetchCard(sv.card, fetchImpl);
    if (!c.ok) return { ...sv, target: null, targetNote: c.refused };
    if (!c.endpoint) return { ...sv, target: null, targetNote: 'its card publishes no A2A 1.x JSON-RPC interface' };
    const target = await mintHandle(env.HANDLE_SECRET!, { anchor: sv.key ?? '', name: sv.name, cardUrl: sv.card, endpoint: c.endpoint, cardDigest: c.digest, registry, ...(sv.capabilities[0] ? { skill: sv.capabilities[0] } : {}) });
    return { ...sv, target, skills: (c.card.skills ?? []).map((s) => ({ id: s.id, name: s.name })) };
  }));
  return { ...found, agents, note: `${found.note} ${GATEWAY_NOTE} Pass an agent's "target" to invoke_agent; it is the only way to reach it through this gateway.` };
}

/** The handle verified and the card re-read: the public facts, and whether the served card is still the pinned one. */
export async function inspectAgent(env: GatewayEnv, args: { target?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDLE_SECRET) return { refused: 'no handle secret configured', note: DISCOVERY_NOTE };
  const v = await verifyHandle(env.HANDLE_SECRET, String(args.target ?? ''));
  if (!v.ok) return { refused: v.refused, note: DISCOVERY_NOTE };
  const c = await fetchCard(v.payload.cardUrl, fetchImpl);
  if (!c.ok) return { refused: c.refused, handle: publicOf(v.payload), note: DISCOVERY_NOTE };
  return { handle: publicOf(v.payload), card: { name: c.card.name, description: c.card.description, provider: c.card.provider, skills: (c.card.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description })), interfaces: (c.card.supportedInterfaces ?? []).map((i) => ({ binding: i.protocolBinding, version: i.protocolVersion })) }, cardMatchesPin: c.digest === v.payload.cardDigest, endpointMatchesPin: c.endpoint === v.payload.endpoint, note: DISCOVERY_NOTE };
}

/** One A2A message to the target, as the gateway agent; the target's task translated. */
export async function invokeAgent(env: GatewayEnv, args: { target?: string; message?: string; task?: string; context?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDLE_SECRET) return { refused: 'no handle secret configured', note: GATEWAY_NOTE };
  const text = String(args.message ?? '').trim();
  if (!text) return { refused: 'message is required — what to ask the agent, in words', note: GATEWAY_NOTE };
  const v = await verifyHandle(env.HANDLE_SECRET, String(args.target ?? ''));
  if (!v.ok) return { refused: v.refused, note: GATEWAY_NOTE };
  const id = identityOf(env);
  if ('refused' in id) return { refused: id.refused, note: GATEWAY_NOTE };
  // The card is read AGAIN and must still name the endpoint the handle pinned — a changed card is said, not followed.
  const c = await fetchCard(v.payload.cardUrl, fetchImpl);
  if (!c.ok) return { refused: c.refused, note: GATEWAY_NOTE };
  if (c.endpoint !== v.payload.endpoint) return { refused: `the card at ${v.payload.cardUrl} now names ${c.endpoint ?? 'no'} A2A endpoint, not the one this handle pinned — discover again`, note: GATEWAY_NOTE };
  const sent = await sendMessage(id, v.payload.endpoint, text, { ...(args.task ? { taskId: args.task } : {}), ...(args.context ? { contextId: args.context } : {}), fetch: fetchImpl });
  if (!sent.ok) return { refused: sent.refused, agent: publicOf(v.payload), note: GATEWAY_NOTE };
  const t = translateTask(sent.task);
  return { agent: publicOf(v.payload), task: t, cardMatchesPin: c.digest === v.payload.cardDigest, note: `${GATEWAY_NOTE} The reply is the agent's own words, under its own playbook; say who said it.` };
}

export async function getTaskTool(env: GatewayEnv, args: { target?: string; task?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDLE_SECRET) return { refused: 'no handle secret configured', note: GATEWAY_NOTE };
  const v = await verifyHandle(env.HANDLE_SECRET, String(args.target ?? ''));
  if (!v.ok) return { refused: v.refused, note: GATEWAY_NOTE };
  const id = identityOf(env);
  if ('refused' in id) return { refused: id.refused, note: GATEWAY_NOTE };
  const taskId = String(args.task ?? '').trim();
  if (!taskId) return { refused: 'task is required', note: GATEWAY_NOTE };
  const got = await getTask(id, v.payload.endpoint, taskId, fetchImpl);
  if (!got.ok) return { refused: got.refused, note: GATEWAY_NOTE };
  return { agent: publicOf(v.payload), task: translateTask(got.task), note: GATEWAY_NOTE };
}

function publicOf(p: HandlePayloadV1): Record<string, unknown> {
  return { anchor: p.anchor, name: p.name, card: p.cardUrl, registry: p.registry, ...(p.skill ? { skill: p.skill } : {}), expiresAt: new Date(p.expiresAt * 1000).toISOString() };
}
