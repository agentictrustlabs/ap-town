import { describe, it, expect } from 'vitest';
import { mintHandle, verifyHandle } from '../src/gateway/handle.js';
import { translateTask } from '../src/gateway/a2a-client.js';
import { discoverAgents, invokeAgent, inspectAgent } from '../src/gateway/tools.js';
import { parseSessionAuthorization, callerAssertionDigest, requestBodyHash } from '@agenticprimitives/a2a/standard';
import { parseSessionWrappedSignature } from '@agenticprimitives/a2a';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverAddress } from 'viem';

const SECRET = 'test-secret';
const PK = generatePrivateKey();
const KEY = privateKeyToAccount(PK).address.toLowerCase();
const AGENT = '0x' + '3d'.repeat(20);
const WIRE = { delegator: AGENT, delegate: KEY, authority: '0x' + '0'.repeat(64), caveats: [], salt: '1', signature: '0xabcd' };
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const CARD = { name: 'Ask Ligonier', protocolVersion: '1.0', supportedInterfaces: [{ url: 'https://edge.faithnet.io/api/a2a/ligonier.svc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], skills: [{ id: 'gc:CFnDiscipleshipCurricula', name: 'Study plans' }] };
const ENTRY = { identifier: 'urn:air:ligonier-svc.faithnet.ai:agent:ligonier', displayName: 'Ligonier Ministries', url: 'https://ligonier-svc.faithnet.ai/.well-known/agent-card.json', capabilities: ['gc:CFnDiscipleshipCurricula'], 'ap:canonicalAgentId': '0x' + 'a'.repeat(40), score: 85, trustManifest: { identity: 'https://ligonier-svc.faithnet.ai', identityType: 'https-fqdn' } };
const env = { HANDLE_SECRET: SECRET, GATEWAY_AGENT: AGENT, GATEWAY_PRIVATE_KEY: PK, GATEWAY_SESSION_WIRE: b64(JSON.stringify(WIRE)), REGISTRY_ORIGIN: 'https://discovery-a2a.faithnet.io', DISCOVERY: { fetch: async () => new Response(JSON.stringify({ results: [ENTRY] }), { headers: { 'content-type': 'application/json' } }) } };
const calls: Array<{ url: string; init?: RequestInit }> = [];
const net = (card = CARD): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url); calls.push({ url: u, init });
  if (u.endsWith('/agent-card.json')) return new Response(JSON.stringify(card), { headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/api/a2a/ligonier.svc')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { task: { id: 't1', contextId: 'c1', status: { state: 'TASK_STATE_COMPLETED', message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'Here is what we offer on justification.' }] } }, artifacts: [{ artifactId: 'a1', name: 'resources', parts: [{ data: { resources: [{ title: 'The Doctrine of Justification' }] } }] }] } } }), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

describe('spec 387 — the AP gateway', () => {
  it('a handle round-trips, and is refused when tampered, foreign, or expired', async () => {
    const h = await mintHandle(SECRET, { anchor: AGENT, name: 'x', cardUrl: 'https://a/.well-known/agent-card.json', endpoint: 'https://edge/api/a2a/x', cardDigest: '0x1', registry: 'r' }, { now: 1000, ttlSec: 60 });
    expect(h.startsWith('ap-agent:')).toBe(true);
    const ok = await verifyHandle(SECRET, h, 1010);
    expect(ok.ok && ok.payload.endpoint).toBe('https://edge/api/a2a/x');
    expect((await verifyHandle(SECRET, h, 1061)).ok).toBe(false);
    expect((await verifyHandle('other', h, 1010)).ok).toBe(false);
    const [body, sig] = h.slice('ap-agent:'.length).split('.');
    const forged = `ap-agent:${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), endpoint: 'https://evil/x' })).toString('base64url')}.${sig}`;
    expect((await verifyHandle(SECRET, forged, 1010)).ok).toBe(false);
    expect((await verifyHandle(SECRET, 'https://evil/x', 1010)).ok).toBe(false);
  });

  it('discover_agents returns each match with a handle bound to the card the registry named', async () => {
    calls.length = 0;
    const out = await discoverAgents(env, { topic: 'justification', capability: 'study plans' }, net()) as { agents: Array<{ name: string; target: string | null; skills: unknown[] }> };
    expect(out.agents[0]!.name).toBe('Ligonier Ministries');
    const v = await verifyHandle(SECRET, out.agents[0]!.target!);
    expect(v.ok && v.payload).toMatchObject({ anchor: '0x' + 'a'.repeat(40), cardUrl: ENTRY.url, endpoint: 'https://edge.faithnet.io/api/a2a/ligonier.svc', registry: 'https://discovery-a2a.faithnet.io/search' });
    expect(JSON.stringify(out)).not.toMatch(/GATEWAY_PRIVATE_KEY|"endpoint"/);
  });

  it('invoke_agent re-reads the card, sends ONE signed SendMessage to the pinned endpoint, and translates the task', async () => {
    calls.length = 0;
    const found = await discoverAgents(env, { topic: 'justification' }, net()) as { agents: Array<{ target: string }> };
    const out = await invokeAgent(env, { target: found.agents[0]!.target, message: 'what do you offer on justification' }, net()) as { task: { state: string; text: string; artifacts: Array<{ name?: string; data?: unknown }> }; cardMatchesPin: boolean };
    expect(out.task).toMatchObject({ state: 'TASK_STATE_COMPLETED', text: 'Here is what we offer on justification.' });
    expect(out.task.artifacts[0]).toMatchObject({ name: 'resources', data: { resources: [{ title: 'The Doctrine of Justification' }] } });
    expect(out.cardMatchesPin).toBe(true);
    const send = calls.find((c) => c.url.endsWith('/api/a2a/ligonier.svc'))!;
    const raw = String(send.init!.body);
    const a = parseSessionAuthorization((send.init!.headers as Record<string, string>).authorization)!;
    expect(a).toMatchObject({ agent: AGENT, method: 'SendMessage', bodyHash: requestBodyHash(raw), audience: 'https://edge.faithnet.io' });
    const wrapped = parseSessionWrappedSignature(a.signature)!;
    expect(wrapped.wire.delegator).toBe(AGENT);
    expect((await recoverAddress({ hash: callerAssertionDigest(a), signature: wrapped.sig })).toLowerCase()).toBe(KEY);
  });

  it('a card that no longer names the pinned endpoint is said, not followed; a foreign target is refused', async () => {
    const found = await discoverAgents(env, { topic: 'justification' }, net()) as { agents: Array<{ target: string }> };
    const moved = { ...CARD, supportedInterfaces: [{ url: 'https://elsewhere.example/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] };
    const out = await invokeAgent(env, { target: found.agents[0]!.target, message: 'hi' }, net(moved)) as { refused?: string };
    expect(out.refused).toMatch(/now names https:\/\/elsewhere.example\/api\/a2a A2A endpoint, not the one this handle pinned/);
    expect(((await invokeAgent(env, { target: 'https://evil/x', message: 'hi' }, net())) as { refused?: string }).refused).toMatch(/not a handle this gateway minted/);
    const insp = await inspectAgent(env, { target: found.agents[0]!.target }, net(moved)) as { endpointMatchesPin: boolean; cardMatchesPin: boolean };
    expect(insp.endpointMatchesPin).toBe(false);
  });

  it('translateTask names a need for input or authority', () => {
    expect(translateTask({ id: 't', contextId: 'c', status: { state: 'TASK_STATE_AUTH_REQUIRED', message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'needs a mandate' }] } }, metadata: { runRef: 'run-1' } } as never)).toMatchObject({ needs: 'authority', runRef: 'run-1', text: 'needs a mandate' });
    expect(translateTask({ id: 't', contextId: 'c', status: { state: 'TASK_STATE_INPUT_REQUIRED' } } as never).needs).toBe('input');
  });
});
