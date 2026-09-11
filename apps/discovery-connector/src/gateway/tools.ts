// THE GATEWAY TOOLS (spec 387 §2): discover_agents (the registry search plus a signed handle per match),
// inspect_agent, invoke_agent, get_task. The host carries handles and task ids; the gateway holds nothing.
import { findServices, type FindServicesResult } from '../catalog.js';
import type { DiscoveryEnv } from '../ard-client.js';
import { mintHandle, verifyHandle, type HandlePayloadV1 } from './handle.js';
import { fetchCard, sendMessage, getTask, translateTask, sha256Hex, type GatewayIdentity } from './a2a-client.js';
import { DISCOVERY_NOTE } from '../whitelabel.js';

export interface GatewayEnv extends DiscoveryEnv {
  HANDLE_SECRET?: string;
  GATEWAY_AGENT?: string;
  /** The gateway agent's session-wire DELEGATE key (spec 387 W2): no authority of its own. A raw Worker secret today;
   *  audit gateway-raw-delegate-key (accepted-risk) schedules the KMS-backed signer + a re-issued wire. */
  GATEWAY_PRIVATE_KEY?: string;
  GATEWAY_SESSION_WIRE?: string;
}

const GATEWAY_NOTE = 'The gateway acts as its own agent of the estate and spends no authority: a read or an informational skill answers; an act waits at the target for its stewards. Discovery authorizes nothing.';

/** Spec 387 W2 — THE FLOW TRACE. One id per assistant turn (the host may pass its own), echoed by every hop:
 *  the gateway's own hops here, the target's `trace` artifact, and each Worker's logs (`[flow <id>]`), so the
 *  outputs of the registry search, the card read, the A2A task, the agent's run and its catalog MCP can be read
 *  in order from one place. Evidence of what ran; nothing in it is authority. */
export interface FlowHop { hop: string; ms: number; request?: Record<string, unknown>; response?: Record<string, unknown> }
const FLOW_ID = /^[A-Za-z0-9_.:-]{4,64}$/;
export function flowIdFor(said: unknown): string {
  return typeof said === 'string' && FLOW_ID.test(said) ? said : `fl-${crypto.randomUUID().slice(0, 8)}`;
}
/** Spec 390 W2 — THE GATEWAY'S TRACE, derived from the flow id so every hop of one flow (discover → inspect →
 *  invoke → continue) is one W3C trace without the MCP host sending a header: the trace id is the flow's, the
 *  parent span id is this tool call's. `tracestate` carries the flow id as this substrate's member so it
 *  survives a foreign hop. Correlation only — the target admits on the signed caller assertion, never this. */
async function traceFor(flowId: string, hop: string): Promise<{ traceId: string; spanId: string; traceparent: string; tracestate: string }> {
  const traceId = (await sha256Hex(`trace:flow:${flowId}`)).slice(2, 34);
  const spanId = (await sha256Hex(`span:flow:${flowId}:${hop}`)).slice(2, 18);
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-01`, tracestate: `ap=${flowId.replace(/[^\x20-\x7e]/g, '').replace(/[,=]/g, '_')}` };
}

function logHop(flowId: string, hop: FlowHop): FlowHop {
  console.log(`[flow ${flowId}] ${hop.hop} ${hop.ms}ms ${JSON.stringify({ ...(hop.request ?? {}), ...(hop.response ?? {}) }).slice(0, 400)}`);
  return hop;
}

/** A task's artifacts ACCUMULATE across turns (a continued task carries the first turn's trace and the second's); the
 *  one that describes the turn just answered is the last of its name. */
function lastArtifact(artifacts: Array<{ name?: string; data?: unknown }>, name: string): Record<string, unknown> | undefined {
  const hit = [...artifacts].reverse().find((a) => a.name === name);
  return hit && hit.data && typeof hit.data === 'object' ? hit.data as Record<string, unknown> : undefined;
}

function identityOf(env: GatewayEnv): GatewayIdentity | { refused: string } {
  if (!env.GATEWAY_AGENT || !env.GATEWAY_PRIVATE_KEY || !env.GATEWAY_SESSION_WIRE) return { refused: 'this gateway has no agent identity configured (GATEWAY_AGENT, GATEWAY_PRIVATE_KEY, GATEWAY_SESSION_WIRE) — it cannot speak to anyone as itself' };
  try {
    const wire = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(env.GATEWAY_SESSION_WIRE.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (env.GATEWAY_SESSION_WIRE.length % 4)) % 4)), (c) => c.charCodeAt(0))));
    return { agent: env.GATEWAY_AGENT, privateKey: env.GATEWAY_PRIVATE_KEY as `0x${string}`, wire };
  } catch { return { refused: 'the gateway\'s session wire is unreadable' }; }
}

/** The registry search of spec 386, each match carrying a handle bound to the card it names. */
export async function discoverAgents(env: GatewayEnv, args: { intent?: string; topic?: string; capability?: string; language?: string; limit?: number; flow?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const flowId = flowIdFor(args.flow); const t0 = Date.now();
  const found = await findServices(env, { ...(args.topic ? { topic: args.topic } : args.intent ? { topic: args.intent } : {}), ...(args.capability ? { capability: args.capability } : {}), ...(args.language ? { language: args.language } : {}), ...(args.limit ? { limit: args.limit } : {}) });
  if ('refused' in found) return found as unknown as Record<string, unknown>;
  if (!env.HANDLE_SECRET) return { ...found, note: `${found.note} No targets: this gateway has no handle secret configured.` };
  const registry = found.query.registry;
  const agents = await Promise.all((found as FindServicesResult).services.map(async (sv) => {
    if (!sv.card) return { ...sv, target: null, targetNote: 'no card to bind a handle to' };
    const c = await fetchCard(sv.card, fetchImpl);
    if (!c.ok) return { ...sv, target: null, targetNote: c.refused };
    if (!c.endpoint) return { ...sv, target: null, targetNote: 'its card publishes no A2A 1.x JSON-RPC interface' };
    // Spec 387 W3 — the registry's own receipt for this entry rides on the handle, so an invoke can say how it found the agent.
    const receipt = (sv as { verification?: { attestations?: Array<{ type: string; uri: string }> } }).verification?.attestations?.find((a) => a.type === 'ap-registry-receipt')?.uri;
    const target = await mintHandle(env.HANDLE_SECRET!, { anchor: sv.key ?? '', name: sv.name, cardUrl: sv.card, endpoint: c.endpoint, cardDigest: c.digest, registry, ...(receipt ? { receipt } : {}), ...(sv.capabilities[0] ? { skill: sv.capabilities[0] } : {}) });
    return { ...sv, target, skills: (c.card.skills ?? []).map((s) => ({ id: s.id, name: s.name })) };
  }));
  const trace = { flowId, hops: [logHop(flowId, { hop: 'gateway.discover', ms: Date.now() - t0, request: { registry: found.query.registry, query: { text: found.query.text, ...(found.query.capability ? { capability: found.query.capability } : {}), ...(found.query.language ? { language: found.query.language } : {}) } }, response: { results: agents.length, withTarget: agents.filter((a) => a.target).length, cards: agents.map((a) => a.card).filter(Boolean) } })] };
  return { ...found, agents, trace, note: `${found.note} ${GATEWAY_NOTE} Pass an agent's "target" to invoke_agent; it is the only way to reach it through this gateway. Pass trace.flowId as "flow" to the next calls to keep one trace.` };
}

/** The handle verified and the card re-read: the public facts, and whether the served card is still the pinned one. */
export async function inspectAgent(env: GatewayEnv, args: { target?: string; flow?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDLE_SECRET) return { refused: 'no handle secret configured', note: DISCOVERY_NOTE };
  const flowId = flowIdFor(args.flow); const t0 = Date.now();
  const v = await verifyHandle(env.HANDLE_SECRET, String(args.target ?? ''));
  if (!v.ok) return { refused: v.refused, note: DISCOVERY_NOTE };
  const c = await fetchCard(v.payload.cardUrl, fetchImpl);
  if (!c.ok) return { refused: c.refused, handle: publicOf(v.payload), note: DISCOVERY_NOTE };
  const trace = { flowId, hops: [logHop(flowId, { hop: 'gateway.inspect', ms: Date.now() - t0, request: { cardUrl: v.payload.cardUrl }, response: { name: c.card.name, endpoint: c.endpoint, cardMatchesPin: c.digest === v.payload.cardDigest } })] };
  return { trace, handle: publicOf(v.payload), card: { name: c.card.name, description: c.card.description, provider: c.card.provider, skills: (c.card.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description })), interfaces: (c.card.supportedInterfaces ?? []).map((i) => ({ binding: i.protocolBinding, version: i.protocolVersion })) }, cardMatchesPin: c.digest === v.payload.cardDigest, endpointMatchesPin: c.endpoint === v.payload.endpoint, note: DISCOVERY_NOTE };
}

/** Spec 387 W3 — CONTINUE a task the target parked on a prompt: the host's answer, keyed by the prompt's field names,
 *  sent as a data part on the SAME task. The target decides whether this caller may answer (the run parked for it),
 *  whether the answer is for a declared field, and what follows — the gateway carries the answer and nothing else. */
export async function continueTask(env: GatewayEnv, args: { target?: string; task?: string; answer?: Record<string, unknown>; note?: string; flow?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDLE_SECRET) return { refused: 'no handle secret configured', note: GATEWAY_NOTE };
  const flowId = flowIdFor(args.flow); const t0 = Date.now();
  const taskId = String(args.task ?? '').trim();
  if (!taskId) return { refused: 'task is required — the taskId invoke_agent returned', note: GATEWAY_NOTE };
  const answer = args.answer && typeof args.answer === 'object' && !Array.isArray(args.answer) ? args.answer : null;
  if (!answer || !Object.keys(answer).length) return { refused: 'answer is required — an object keyed by the prompt\'s field names (task.prompt.fields), e.g. { "id": "…" }', note: GATEWAY_NOTE };
  const v = await verifyHandle(env.HANDLE_SECRET, String(args.target ?? ''));
  if (!v.ok) return { refused: v.refused, note: GATEWAY_NOTE };
  const id = identityOf(env);
  if ('refused' in id) return { refused: id.refused, note: GATEWAY_NOTE };
  const c = await fetchCard(v.payload.cardUrl, fetchImpl);
  if (!c.ok) return { refused: c.refused, note: GATEWAY_NOTE };
  if (c.endpoint !== v.payload.endpoint) return { refused: `the card at ${v.payload.cardUrl} now names ${c.endpoint ?? 'no'} A2A endpoint, not the one this handle pinned — discover again`, note: GATEWAY_NOTE };
  const tc = await traceFor(flowId, 'continue');
  const sent = await sendMessage(id, v.payload.endpoint, String(args.note ?? '').trim(), { taskId, fetch: fetchImpl, flowId, data: answer, traceparent: tc.traceparent, tracestate: tc.tracestate });
  const hop = { hop: 'gateway.continue', ms: Date.now() - t0, request: { endpoint: v.payload.endpoint, as: id.agent, taskId, fields: Object.keys(answer) } };
  if (!sent.ok) { logHop(flowId, { ...hop, response: { refused: sent.refused } }); return { refused: sent.refused, agent: publicOf(v.payload), trace: { flowId, hops: [] }, note: GATEWAY_NOTE }; }
  const t = translateTask(sent.task);
  const agentTrace = lastArtifact(t.artifacts, 'trace');
  const trace = { flowId, hops: [logHop(flowId, { ...hop, response: { taskId: t.taskId, state: t.state, artifacts: t.artifacts.map((a) => a.name ?? '?'), chars: t.text.length, ...(t.needs ? { needs: t.needs } : {}) } }), ...(agentTrace ? [{ ...agentTrace, hop: 'agent.run', ms: Number(agentTrace.ms ?? 0) }] : [])] };
  return { agent: publicOf(v.payload), task: t, trace, note: `${GATEWAY_NOTE} The reply is the agent's own words on the continued task.` };
}

/** One A2A message to the target, as the gateway agent; the target's task translated. */
export async function invokeAgent(env: GatewayEnv, args: { target?: string; message?: string; task?: string; context?: string; flow?: string }, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!env.HANDLE_SECRET) return { refused: 'no handle secret configured', note: GATEWAY_NOTE };
  const flowId = flowIdFor(args.flow); const t0 = Date.now();
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
  const tCard = Date.now() - t0; const t1 = Date.now();
  const referral = { registry: v.payload.registry, ...(v.payload.receipt ? { receipt: v.payload.receipt } : {}) };
  const tc = await traceFor(flowId, 'invoke');
  const sent = await sendMessage(id, v.payload.endpoint, text, { ...(args.task ? { taskId: args.task } : {}), ...(args.context ? { contextId: args.context } : {}), fetch: fetchImpl, flowId, referral, traceparent: tc.traceparent, tracestate: tc.tracestate });
  if (!sent.ok) { logHop(flowId, { hop: 'gateway.invoke', ms: Date.now() - t1, request: { endpoint: v.payload.endpoint, chars: text.length }, response: { refused: sent.refused } }); return { refused: sent.refused, agent: publicOf(v.payload), trace: { flowId, hops: [] }, note: GATEWAY_NOTE }; }
  const t = translateTask(sent.task);
  // The target's own trace artifact (its run: playbook, planner, steps, outputs) is lifted into this trace as
  // the next hop, so one object tells the whole story; the artifact stays on the task as well.
  const agentTrace = lastArtifact(t.artifacts, 'trace');
  const trace = {
    flowId,
    // Spec 390 W2 — the W3C trace every hop of this flow rode under; the target's run echoes it (agent.run.traceId).
    traceId: tc.traceId,
    hops: [
      logHop(flowId, { hop: 'gateway.card', ms: tCard, request: { cardUrl: v.payload.cardUrl }, response: { endpoint: c.endpoint, cardMatchesPin: c.digest === v.payload.cardDigest } }),
      logHop(flowId, { hop: 'gateway.invoke', ms: Date.now() - t1, request: { endpoint: v.payload.endpoint, as: id.agent, method: args.task ? 'SendMessage(taskId)' : 'SendMessage', chars: text.length }, response: { taskId: t.taskId, state: t.state, artifacts: t.artifacts.map((a) => a.name ?? '?'), chars: t.text.length, ...(t.needs ? { needs: t.needs } : {}) } }),
      ...(agentTrace ? [{ ...agentTrace, hop: 'agent.run', ms: Number(agentTrace.ms ?? 0) }] : []),
    ],
  };
  return { agent: publicOf(v.payload), task: t, cardMatchesPin: c.digest === v.payload.cardDigest, trace, note: `${GATEWAY_NOTE} The reply is the agent's own words, under its own playbook; say who said it.` };
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
