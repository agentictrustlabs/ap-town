// THE GATEWAY AS ITS OWN CALLER (spec 387 §1/§3; spec 372 S3c). One A2A request, signed: the caller assertion binds
// the gateway agent, the method, the exact body bytes, the audience and the moment; the signature is the session-
// wrapped form — the wire (gateway.svc → this key, pinned to harness.ask, custodian-signed) beside the key's
// signature. The receiver verifies the wire on chain per request; revoking it kills the gateway everywhere.
import { wrapSessionSignature, type DelegationWireV1 } from '@agenticprimitives/a2a';
import { callerAssertionDigest, requestBodyHash, sessionAuthorizationHeader, type CallerAssertionV1 } from '@agenticprimitives/a2a/standard';
import type { TaskV1, MessageV1, AgentCardV1 } from '@agenticprimitives/a2a/standard';
import { sign as signRaw } from 'viem/accounts';
import type { Hex } from 'viem';

export interface GatewayIdentity { agent: string; privateKey: Hex; wire: DelegationWireV1 }

export interface TranslatedTask {
  /** Spec 387 W3 — the target's prompt when it needs input: `{ kind, prompt, stepRef, fields? }`. */
  prompt?: Record<string, unknown>;
  taskId: string | null; contextId?: string; state: string; text: string;
  artifacts: Array<{ name?: string; text?: string; data?: unknown }>;
  needs?: 'input' | 'authority'; runRef?: string;
}

export const sha256Hex = async (text: string): Promise<string> => `0x${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/** The card at a URL, its digest, and its A2A 1.x JSON-RPC endpoint (null when it publishes none). */
export async function fetchCard(cardUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; card: AgentCardV1 & { protocolVersion?: string }; digest: string; endpoint: string | null } | { ok: false; refused: string }> {
  let res: Response;
  try { res = await fetchImpl(cardUrl, { headers: { accept: 'application/json' } }); } catch (e) { return { ok: false, refused: `the card at ${cardUrl} could not be read: ${e instanceof Error ? e.message : String(e)}` }; }
  if (!res.ok) return { ok: false, refused: `the card at ${cardUrl} answered ${res.status}` };
  const text = await res.text();
  let card: AgentCardV1 & { protocolVersion?: string };
  try { card = JSON.parse(text); } catch { return { ok: false, refused: `the card at ${cardUrl} is not JSON` }; }
  const top = /^1\./.test(String(card.protocolVersion ?? ''));
  const hit = (card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && (/^1\./.test(String(i.protocolVersion ?? '')) || (i.protocolVersion === undefined && top)) && typeof i.url === 'string' && /^https:\/\//.test(i.url));
  return { ok: true, card, digest: await sha256Hex(text), endpoint: hit?.url ?? null };
}

async function signedHeaders(id: GatewayIdentity, endpoint: string, raw: string): Promise<Record<string, string>> {
  const base: Omit<CallerAssertionV1, 'signature'> = {
    agent: id.agent.toLowerCase(), method: (JSON.parse(raw) as { method: string }).method, bodyHash: requestBodyHash(raw),
    issuedAt: Math.floor(Date.now() / 1000), audience: new URL(endpoint).origin,
  };
  const sig = await signRaw({ hash: callerAssertionDigest(base), privateKey: id.privateKey, to: 'hex' });
  const assertion: CallerAssertionV1 = { ...base, signature: wrapSessionSignature(id.wire, sig) };
  return { 'content-type': 'application/json', accept: 'application/json', 'a2a-version': '1.0', authorization: sessionAuthorizationHeader(assertion) };
}

const hex32 = (): string => `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export async function sendMessage(id: GatewayIdentity, endpoint: string, text: string, opts: { taskId?: string; contextId?: string; fetch?: typeof fetch; /** Spec 387 W2 — the flow id the target echoes in its `trace` artifact and its logs. */ flowId?: string; /** Spec 390 W2 — W3C Trace Context for the hop: the gateway's trace, this call as the parent span. */ traceparent?: string; tracestate?: string; /** Spec 387 W3 — how this gateway found the target (the registry and its receipt), said to the target as evidence. */ referral?: { registry: string; receipt?: string }; /** Spec 387 W3 — a continuation's answer to the target's prompt, keyed by the prompt's field names. */ data?: Record<string, unknown> } = {}): Promise<{ ok: true; task: TaskV1 } | { ok: false; refused: string; status?: number }> {
  const metadata = { ...(opts.flowId ? { flowId: opts.flowId } : {}), ...(opts.referral ? { referral: opts.referral } : {}) };
  const message: MessageV1 = { messageId: hex32(), role: 'ROLE_USER', parts: [...(text ? [{ text }] : []), ...(opts.data ? [{ data: opts.data }] : [])], ...(opts.taskId ? { taskId: opts.taskId } : {}), ...(opts.contextId ? { contextId: opts.contextId } : {}), ...(Object.keys(metadata).length ? { metadata } : {}) };
  const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message } });
  return rpc(id, endpoint, raw, opts.fetch ?? fetch, opts.traceparent ? { traceparent: opts.traceparent, ...(opts.tracestate ? { tracestate: opts.tracestate } : {}) } : {});
}

export async function getTask(id: GatewayIdentity, endpoint: string, taskId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; task: TaskV1 } | { ok: false; refused: string; status?: number }> {
  const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: taskId } });
  return rpc(id, endpoint, raw, fetchImpl);
}

async function rpc(id: GatewayIdentity, endpoint: string, raw: string, fetchImpl: typeof fetch, extra: Record<string, string> = {}): Promise<{ ok: true; task: TaskV1 } | { ok: false; refused: string; status?: number }> {
  let res: Response;
  // Spec 390 W2 — W3C Trace Context rides beside the signed caller assertion: correlation, never part of what is signed or admitted.
  try { res = await fetchImpl(endpoint, { method: 'POST', headers: { ...(await signedHeaders(id, endpoint, raw)), ...extra }, body: raw }); } catch (e) { return { ok: false, refused: `could not reach ${endpoint}: ${e instanceof Error ? e.message : String(e)}` }; }
  const body = (await res.json().catch(() => null)) as { result?: { task?: TaskV1 }; error?: { code: number; message: string } } | null;
  if (!body) return { ok: false, refused: `${endpoint} answered ${res.status} with no JSON-RPC body`, status: res.status };
  if (body.error) return { ok: false, refused: `${endpoint} answered ${body.error.code}: ${body.error.message}`, status: res.status };
  const task = body.result?.task ?? (body.result as unknown as TaskV1 | undefined);
  if (!task || typeof task !== 'object' || !('status' in task)) return { ok: false, refused: `${endpoint} answered without a task`, status: res.status };
  return { ok: true, task };
}

/** A2A task → what an MCP host reads. The target's words verbatim; a need for input or authority named as such. */
export function translateTask(task: TaskV1): TranslatedTask {
  const state = String(task.status?.state ?? 'unknown');
  const text = (task.status?.message?.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).filter(Boolean).join(' ');
  const artifacts = (task.artifacts ?? []).map((a) => ({ ...(a.name ? { name: a.name } : {}), ...(a.parts.find((p) => typeof p.text === 'string') ? { text: a.parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ') } : {}), ...(a.parts.find((p) => p.data !== undefined) ? { data: a.parts.find((p) => p.data !== undefined)!.data } : {}) }));
  const meta = (task.metadata ?? {}) as { runRef?: string };
  const needs = /INPUT_REQUIRED/.test(state) ? 'input' : /AUTH_REQUIRED/.test(state) ? 'authority' : undefined;
  // Spec 387 W3 — WHAT the target asks for: the prompt's data part (kind, the question, the field names) so a host
  // can answer it with continue_task keyed by exactly those names.
  const prompt = needs === 'input' ? (task.status?.message?.parts ?? []).find((p) => p.data && typeof p.data === 'object')?.data as Record<string, unknown> | undefined : undefined;
  return { taskId: task.id ?? null, ...(task.contextId ? { contextId: task.contextId } : {}), state, text, artifacts, ...(needs ? { needs } : {}), ...(prompt ? { prompt } : {}), ...(meta.runRef ? { runRef: meta.runRef } : {}) };
}
