// The naming service's answers (spec 430 §3–§4), assembled from chain reads. Everything here is a READ of public
// state; nothing is stored, signed or granted. Each view states what the contracts check and no more.
import {
  AGENT_TLDS, LEGACY_TLDS, RESERVED_LABELS, namehash, parseAgentName, priceOf, pricedSubregistryAbi,
  typedNameForLabel, validateTypedClaim, type ParsedAgentName,
} from '@agenticprimitives/agent-naming';
import type { TownManifest } from '@ap-town/town-model';
import { concat, isAddress, keccak256 } from 'viem';
import type {
  Address, AddressView, Banner, CanRow, DisplayView, EstateRef, Hex, NameRow, NameView, RecordRow, RootPage, RootView,
  SearchRow, SearchView, Signal, Stamp, TownView,
} from '../src/api-types';
import { ZERO, ZERO_NODE, type Chain } from './chain';
import { NOUN, RECORD_LABEL, RULE_WORDS, kindOfTld, kindOfType, nounOfTld, typeOfTld } from './words';

export const PAGE_SIZE = 48;

/** Spec 431 §3 — the domain that protects `label`: the first of `<label>.com`, `<label>.org` that exists in DNS
 *  (A, AAAA, MX or NS), read over DNS-over-HTTPS. A public fact; `unknown` when the lookup could not run. */
export async function protectingDomain(label: string, fetchFn: typeof fetch = fetch): Promise<{ domain: string | null; unknown: boolean }> {
  let unknown = false;
  for (const tld of ['com', 'org']) {
    const host = `${label}.${tld}`;
    try {
      let found = false;
      for (const type of ['A', 'AAAA', 'MX', 'NS']) {
        const r = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
        if (!r.ok) { unknown = true; break; }
        const b = (await r.json()) as { Status?: number; Answer?: unknown[] };
        if (b.Status === 0 && Array.isArray(b.Answer) && b.Answer.length > 0) { found = true; break; }
      }
      if (found) return { domain: host, unknown: false };
    } catch { unknown = true; }
  }
  return { domain: null, unknown };
}

const coinsOf = (units: bigint, decimals: number): number => Number(units / 10n ** BigInt(decimals));
const CHILD_CAP = 60;
const SAMPLE = 6;

export interface Ctx {
  town: TownManifest;
  chain: Chain;
  /** Ask the town's registry whether it lists an agent. `null` = it could not be asked. */
  listed(agent: Address): Promise<boolean | null>;
}

const lower = (a: string): Address => a.toLowerCase() as Address;
const nz = (a: string | null | undefined): Address | null => (a && a !== ZERO ? lower(a) : null);

export const estatesOf = (town: TownManifest): EstateRef[] => town.estates.map((e) => ({ id: e.id, home: e.home, naming: `${e.home.replace(/\/$/, '')}/naming` }));

async function stamp(ctx: Ctx): Promise<Stamp> {
  return { town: ctx.town.town, chainId: ctx.town.chain.id, block: Number(await ctx.chain.client.getBlockNumber()) };
}

/** Display form of an on-chain dotted name (`vault.svc.richcanvas.org` → `vault.svc@richcanvas.org`). */
export function displayOf(onChain: string): string {
  try { return parseAgentName(onChain).normalized; } catch { return onChain; }
}

/** What kind of place a name is, from its own suffix (the label just before a context, or the last label). */
function kindOfName(display: string): ReturnType<typeof kindOfTld> {
  const head = display.split('@')[0] ?? display;
  const parts = head.split('.');
  return kindOfTld(parts.length > 1 ? parts[parts.length - 1]! : null);
}

// ── roots ────────────────────────────────────────────────────────────────────────────────────────────────────────

function issuingSentence(tld: string, subregistry: Address | null, open: boolean): string {
  if (open) return `Open: any agent may claim one name under .${tld}, three characters or more. A claim never expires and is never released.`;
  if (subregistry) return `Names under .${tld} are issued by the contract at ${subregistry}.`;
  return `Only the root's owner issues names under .${tld}.`;
}

async function rootViewOf(ctx: Ctx, node: Hex): Promise<RootView> {
  const { chain, town } = ctx;
  const [label, count, sub] = await Promise.all([chain.reg<string>('label', [node]), chain.reg<bigint>('childCount', [node]), chain.reg<Address>('subregistry', [node])]);
  const subregistry = nz(sub);
  const priced = !!subregistry && chain.pricedSet.has(subregistry);
  const open = !!subregistry && chain.open.has(subregistry);
  let baseCoins: number | null = null;
  if (priced) { try { baseCoins = priceOf('abcdefgh', label); } catch { baseCoins = null; } }
  return {
    tld: label, priced, baseCoins, names: nounOfTld(label), kind: kindOfTld(label), legacy: !typeOfTld(label), count: Number(count),
    issuing: priced ? `Bought: a .${label} name costs Sheqel, paid from the agent's treasury — ${baseCoins ?? '?'} SHQ for eight letters or more, up to 49 for three. One per agent; never expires, never released.` : issuingSentence(label, subregistry, open), subregistry, open,
    estates: town.estates.filter((e) => e.nameRoots.includes(label)).map((e) => e.id),
  };
}

const ROOT_ORDER = [...AGENT_TLDS, ...LEGACY_TLDS] as readonly string[];
const rootRank = (tld: string) => { const i = ROOT_ORDER.indexOf(tld); return i < 0 ? 999 : i; };

export async function rootViews(ctx: Ctx): Promise<RootView[]> {
  const nodes = await ctx.chain.reg<Hex[]>('getRoots');
  const views = await Promise.all(nodes.map((n) => rootViewOf(ctx, n)));
  return views.sort((a, b) => rootRank(a.tld) - rootRank(b.tld) || a.tld.localeCompare(b.tld));
}

/** Names directly under `parentOnChain`, in the chain's own order (registration order), a slice at a time. */
async function rowsUnder(ctx: Ctx, parentOnChain: string, from: number, size: number): Promise<{ rows: NameRow[]; total: number }> {
  const { chain } = ctx;
  const parent = namehash(parentOnChain) as Hex;
  const hashes = await chain.reg<Hex[]>('childLabelhashes', [parent]);
  const slice = hashes.slice(from, from + size);
  // A child's node is keccak(parent ‖ labelhash) — computed here, not read (the registry stores the labelhash).
  const nodes = slice.map((h) => keccak256(concat([parent, h])) as Hex);
  const facts = await Promise.all(nodes.map((n) => Promise.all([chain.reg<string>('label', [n]), chain.reg<Address>('owner', [n])])));
  const rows = facts.map(([label, owner], i) => {
    const onChain = label ? `${label}.${parentOnChain}` : `[${(slice[i] ?? '0x').slice(0, 10)}…].${parentOnChain}`;
    const name = label ? displayOf(onChain) : onChain;
    return { name, label: label || '(unlabelled)', owner: lower(owner), kind: kindOfName(name) };
  });
  return { rows, total: hashes.length };
}

export async function townView(ctx: Ctx): Promise<TownView> {
  const [s, roots] = await Promise.all([stamp(ctx), rootViews(ctx)]);
  const samples = await Promise.all(roots.map((r) => (r.count ? rowsUnder(ctx, r.tld, 0, SAMPLE).then((x) => x.rows) : Promise.resolve([]))));
  let fees: TownView['fees'] = null;
  if (ctx.chain.feeTreasury && ctx.chain.coin) {
    const bal = await ctx.chain.client.readContract({ address: ctx.chain.coin.address, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [ctx.chain.feeTreasury] }).catch(() => 0n);
    fees = { treasury: ctx.chain.feeTreasury, coin: ctx.chain.coin.symbol, coins: coinsOf(bal as bigint, ctx.chain.coin.decimals) };
  }
  return { ...s, estates: estatesOf(ctx.town), fees, roots: roots.map((r, i) => ({ ...r, sample: samples[i] ?? [] })), total: roots.reduce((n, r) => n + r.count, 0) };
}

export async function rootPage(ctx: Ctx, tld: string, page: number): Promise<RootPage | null> {
  const t = tld.toLowerCase();
  if (!/^[a-z0-9-]{1,63}$/.test(t)) return null;
  const node = await ctx.chain.reg<Hex>('rootByLabel', [t]);
  if (node === ZERO_NODE) return null;
  const p = Math.max(1, Math.floor(page) || 1);
  const [s, root, list] = await Promise.all([stamp(ctx), rootViewOf(ctx, node), rowsUnder(ctx, t, (p - 1) * PAGE_SIZE, PAGE_SIZE)]);
  return { ...s, root, page: p, pages: Math.max(1, Math.ceil(list.total / PAGE_SIZE)), pageSize: PAGE_SIZE, names: list.rows, estates: estatesOf(ctx.town) };
}

// ── a name ───────────────────────────────────────────────────────────────────────────────────────────────────────

function refusal(e: unknown): { rule: string; detail: string } {
  const msg = String((e as Error)?.message ?? e);
  const m = msg.match(/invalid name "[^"]*": ([a-z_]+): (.*)$/);
  if (m) return { rule: m[1]!, detail: RULE_WORDS[m[1]!] ?? m[2]! };
  if (/characters outside/.test(msg)) return { rule: 'charset', detail: RULE_WORDS.charset! };
  return { rule: 'invalid', detail: msg.replace(/^\[agent-naming\]\s*/, '') };
}

function recordRows(records: Record<string, unknown>): RecordRow[] {
  return Object.entries(records).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([key, v]) => {
    const value = typeof v === 'string' ? v : JSON.stringify(v);
    const kind: RecordRow['kind'] = /^https?:\/\//.test(value) ? 'url' : /^0x[0-9a-fA-F]{40}$/.test(value) ? 'address' : /^0x[0-9a-fA-F]{64}$/.test(value) ? 'hash' : 'text';
    return { key, label: RECORD_LABEL[key] ?? key, value, kind };
  });
}

const VIOLATION_WORDS = (v: ReturnType<typeof validateTypedClaim>[number], tld: string): string => {
  switch (v.code) {
    case 'type_undeclared': return `The agent this name points at has not declared a type, so .${tld} cannot be read as ${NOUN[typeOfTld(tld) ?? ''] ?? 'its type'}.`;
    case 'type_mismatch': return `The suffix .${tld} names ${NOUN[v.expected] ?? v.expected}, but the agent declares itself ${NOUN[v.actual] ?? v.actual}.`;
    case 'kind_mismatch': return `The name's kind record says ${v.actual}; the agent's type belongs to ${v.expected}.`;
    case 'role_required': return `A .${tld} name needs the agent's service role to say the same thing, and it does not.`;
    case 'subtype_mismatch': return `The suffix names the subtype ${v.expected}; the agent declares ${v.actual ?? 'none'}.`;
    case 'label_reads_as_type': return v.detail;
    default: return v.detail;
  }
};

/** The host a name's own records publish (its endpoint or card), and which estate's zone it is in. Read, never computed. */
function hostsOf(town: TownManifest, records: Record<string, unknown>): Array<{ estate: string; host: string }> {
  const url = (records.a2aEndpoint ?? records.cardUri ?? records.serviceUrl ?? records.siteUrl) as string | undefined;
  if (!url) return [];
  let host: string;
  try { host = new URL(url).host; } catch { return []; }
  const estate = town.estates.find((e) => (e.agentZone && host.endsWith(`.${e.agentZone}`)) || new URL(e.edge).host === host || new URL(e.a2a).host === host);
  return [{ estate: estate?.id ?? '', host }];
}

function capabilities(v: { name: string; tld: string | null; owner: Address | null; ownerName: string | null; agent: Address | null; presented: string | null; subregistry: Address | null; open: boolean; priced?: boolean; legacy: boolean }): CanRow[] {
  const rows: CanRow[] = [];
  if (v.owner) {
    rows.push({
      who: "The name's owner", address: v.owner, name: v.ownerName,
      note: v.owner === v.agent ? 'The same agent the name points at. Its own custody policy stands behind every call.' : 'An agent. Its own custody policy stands behind every call.',
      can: ['change the records', 'change the resolver', 'hand the issuing of names under it to a subregistry', 'register names under it', 'renew it', 'transfer the name to another owner'],
      cannot: ["declare another agent's type", "make this name another agent's presented name"],
    });
  }
  if (v.subregistry) {
    rows.push({
      who: v.open ? 'The open subregistry' : v.priced ? 'The priced subregistry' : 'The subregistry', address: v.subregistry,
      note: v.open ? 'A contract with one rule: one claim per agent, three characters or more, never expires.' : v.priced ? 'A contract with one rule: a name costs its price, paid by the owner’s treasury, with a ticket from the owner’s Home; one per agent; never expires.' : 'A contract the owner handed child-issuing to.',
      can: ['register names under this name, by its own rule'],
      cannot: ["touch this name's records, owner or resolver"],
    });
  }
  if (v.agent) {
    rows.push({
      who: 'The agent it points at', address: v.agent, name: v.presented,
      can: ['present this name as its own, because the name points back at it', 'declare its own type'],
      cannot: ['be given a type by anyone else'],
    });
  }
  rows.push({
    who: 'Anyone holding or reading this name',
    can: ['resolve it, read its records, and find the agent'],
    cannot: ['act for the agent. A name is an address card; authority is a delegation the agent signs, checked on chain'],
  });
  return rows;
}

export async function nameView(ctx: Ctx, input: string): Promise<NameView> {
  const { chain, town } = ctx;
  const s = await stamp(ctx);
  const estates = estatesOf(town);
  const raw = input.trim();
  const blank = (over: Partial<NameView>): NameView => ({
    ...s, input: raw, status: 'invalid', name: raw.toLowerCase(), onChainName: raw.toLowerCase(), form: 'canonical', tld: null, kind: 'legacy', names: null,
    legacy: false, node: ZERO_NODE, agent: null, displayName: null, owner: null, ownerName: null, presented: null, presentsThis: false, declared: null,
    typeCheck: null, records: [], signals: null, banners: [], can: [], children: [], childCount: 0, details: null, availability: null, price: null, purchase: null, estates, ...over,
  });

  let p: ParsedAgentName;
  try { p = parseAgentName(raw); } catch (e) { return blank({ invalid: refusal(e) }); }
  if (p.kind === 'root') return blank({ invalid: { rule: 'root', detail: `.${p.normalized} is a root, not a name. It has its own page.` }, tld: p.normalized, form: 'root' });

  const node = p.node as Hex;
  const tld = p.kind === 'type-node' ? null : (p.handle?.tld ?? p.tld ?? null);
  const base = { name: p.normalized, onChainName: p.onChainName, form: p.kind as NameView['form'], tld, kind: p.kind === 'type-node' ? kindOfTld(p.onChainName.split('.')[0] ?? null) : kindOfTld(tld), names: nounOfTld(tld), legacy: !!p.legacy, node };
  const parentOnChain = p.onChainName.split('.').slice(1).join('.');
  const parentNode = namehash(parentOnChain) as Hex;

  const [exists, ownerRaw, resolverRaw, subRaw, expiry, registeredAt, expired, target, childCount, parentExists, parentSub] = await Promise.all([
    chain.reg<boolean>('recordExists', [node]), chain.reg<Address>('owner', [node]), chain.reg<Address>('resolver', [node]), chain.reg<Address>('subregistry', [node]),
    chain.reg<bigint>('expiry', [node]), chain.reg<bigint>('registeredAt', [node]), chain.reg<boolean>('isExpired', [node]),
    chain.ur<Address>('resolveName', [node]), chain.reg<bigint>('childCount', [node]),
    chain.reg<boolean>('recordExists', [parentNode]), chain.reg<Address>('subregistry', [parentNode]),
  ]);
  const owner = nz(ownerRaw);
  const details = (records: Record<string, unknown> = {}): NonNullable<NameView['details']> => ({
    parent: parentOnChain, resolver: nz(resolverRaw), subregistry: nz(subRaw),
    registeredAt: Number(registeredAt) || null, expiry: Number(expiry) || null, hosts: hostsOf(town, records),
  });

  if (!exists) {
    if (owner && expired) {
      return blank({ ...base, status: 'expired', owner, details: details(), banners: [{ tone: 'warn', title: 'Expired', body: 'This name was registered and has expired. It no longer resolves, and whoever issues names under its parent can register it again.' }] });
    }
    if (!parentExists) {
      return blank({ ...base, status: 'not-claimable', availability: { by: 'nobody yet', rule: p.kind === 'scoped' || p.kind === 'type-node' ? `${displayOf(parentOnChain)} is not registered, so nothing can be issued under it.` : `This town has no .${tld} root.` } });
    }
    const parentSubAddr = nz(parentSub);
    const parentOpen = !!parentSubAddr && chain.open.has(parentSubAddr);
    const parentPriced = !!parentSubAddr && chain.pricedSet.has(parentSubAddr);
    const noun = nounOfTld(tld);
    let price: NameView['price'] = null;
    if (parentPriced && tld && p.kind === 'canonical' && chain.coin) {
      const label = p.onChainName.split('.')[0]!;
      let coins = 0;
      try { coins = priceOf(label, tld) ?? 0; } catch { coins = 0; }
      const prot = await protectingDomain(label);
      price = { coins, coin: chain.coin.symbol, protectedBy: prot.domain, dnsUnknown: prot.unknown && !prot.domain };
    }
    const availability = p.kind === 'scoped' || p.kind === 'type-node'
      ? { by: `the context, ${p.context ? `${p.context.label}.${p.context.tld}` : displayOf(parentOnChain)}`, rule: 'A scoped name is issued by its context, from that organization’s Home.' }
      : parentPriced
        ? { by: noun ? `${noun}’s agent` : 'an agent', rule: `Bought from that agent’s Home for ${price?.coins ?? '?'} ${chain.coin?.symbol ?? 'coins'}, paid by its treasury in the same signed operation that registers the name. One name per agent under .${tld}; it never expires and is never resold.${price?.protectedBy ? ` ${p.onChainName.split('.')[0]} is a domain: the buyer needs a verified email at ${price.protectedBy} on their Home.` : ''}` }
        : parentOpen
          ? { by: noun ? `${noun}’s agent` : 'an agent', rule: `Claimed from that agent’s Home in one signed operation. One name per agent under .${tld}; it never expires.${noun ? ` It reads as ${noun}’s name only while the agent’s own type record says so.` : ''}` }
          : { by: 'whoever issues names under this root', rule: `Names under .${tld} are not open to claim.` };
    return blank({ ...base, status: 'available', availability, price });
  }

  const agent = nz(target);
  const [records, declared, presentedRaw, ownerNameRaw, kids, listed] = await Promise.all([
    chain.naming.getRecords(p.onChainName) as Promise<Record<string, unknown>>,
    agent ? chain.naming.readDerivedType(agent) : Promise.resolve(null),
    agent ? chain.ur<string>('reverseResolveString', [agent]) : Promise.resolve(''),
    owner && owner !== agent ? chain.ur<string>('reverseResolveString', [owner]) : Promise.resolve(null),
    Number(childCount) ? rowsUnder(ctx, p.onChainName, 0, CHILD_CAP) : Promise.resolve({ rows: [], total: 0 }),
    agent ? ctx.listed(agent) : Promise.resolve(false),
  ]);
  const presented = presentedRaw ? displayOf(presentedRaw) : null;
  const presentsThis = !!presentedRaw && presentedRaw.toLowerCase() === p.onChainName;
  const ownerName = ownerNameRaw === null ? presented : ownerNameRaw ? displayOf(ownerNameRaw) : null;

  // The type check: the package's own validator over what the chain says (spec 346 §2.3). Legacy and type-node
  // names are not typed claims and are never checked.
  let typeCheck: NameView['typeCheck'] = null;
  const banners: Banner[] = [];
  if ((p.kind === 'canonical' || p.kind === 'scoped') && !p.legacy && tld) {
    if (!agent || !declared) typeCheck = { ok: false, reason: 'no_agent', detail: 'The name points at no agent.' };
    else {
      const v = validateTypedClaim({ name: p, subject: { agentType: declared.agentType, serviceRole: declared.serviceRole, nameKind: (records.agentKind as never) ?? null, agentSubtype: declared.agentSubtype } }).filter((x) => x.code !== 'label_reads_as_type');
      typeCheck = v.length ? { ok: false, reason: v[0]!.code, detail: VIOLATION_WORDS(v[0]!, tld) } : { ok: true };
    }
    if (!typeCheck.ok) banners.push({ tone: 'warn', title: typeCheck.reason === 'type_undeclared' ? 'Type not declared' : 'Type mismatch', body: `${typeCheck.detail} Until the agent’s own record agrees, this is not a valid .${tld} name and apps that check types will not accept it. The agent fixes this from its Home.` });
  }
  if (p.legacy) banners.push({ tone: 'info', title: 'Legacy root', body: `.${tld} is an untyped root from before typed names. Its names resolve, but the suffix says nothing about what the agent is.` });
  if (agent && !presentsThis) {
    banners.push(presented
      ? { tone: 'info', title: 'Not the name this agent presents', body: `This name resolves to the agent, but the agent presents ${presented} as its own. Apps that follow the display rule show ${presented}.` }
      : { tone: 'info', title: 'The agent presents no name', body: 'This name resolves to the agent, but the agent has not set a presented name. Apps that follow the display rule show its address.' });
  }
  if (agent && !records.addr) banners.push({ tone: 'info', title: 'No address record', body: 'The name has no address record, so it resolves to its owner.' });
  if (Number(expiry)) banners.push({ tone: 'info', title: 'This name has an expiry', body: `It expires on ${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)}. Its owner can renew it.` });

  const endpoint = (records.a2aEndpoint ?? records.serviceUrl ?? records.mcpEndpoint) as string | undefined;
  const typeNoun = declared?.agentType ? NOUN[declared.agentType] ?? declared.agentType : null;
  const signals: NonNullable<NameView['signals']> = {
    named: agent ? { state: 'yes', detail: 'Registered, and it points at an agent.' } : { state: 'warn', detail: 'Registered, but it points at no agent.' },
    typed: typeCheck === null
      ? { state: 'unknown', detail: p.legacy ? 'A legacy name is never type-checked.' : 'A type node names no agent; it holds scoped names.' }
      : typeCheck.ok ? { state: 'yes', detail: `The agent declares itself ${typeNoun}, which is what .${tld} names.` } : { state: 'no', detail: typeCheck.detail ?? 'The suffix and the agent’s type record disagree.' },
    listed: listed === null ? { state: 'unknown', detail: 'The town’s registry could not be asked just now.' }
      : listed ? { state: 'yes', detail: 'Listed in the town’s registry.' } : { state: 'no', detail: 'Not listed in the town’s registry. A name does not need a listing.' },
    reachable: endpoint ? { state: 'yes', detail: `Publishes an endpoint: ${safeHost(endpoint)}.` } : { state: 'no', detail: 'Publishes no endpoint in its records.' },
  };
  const sub = nz(subRaw);
  const open = !!sub && chain.open.has(sub);
  // Bought through the root's priced subregistry? Read what was paid and when — storage, never a log.
  let purchase: NameView['purchase'] = null;
  const parentPricedAddr = nz(parentSub);
  if (parentPricedAddr && chain.pricedSet.has(parentPricedAddr) && chain.coin) {
    const [paid, at] = await Promise.all([
      chain.client.readContract({ address: parentPricedAddr, abi: pricedSubregistryAbi, functionName: 'paid', args: [node] }).catch(() => 0n),
      chain.client.readContract({ address: parentPricedAddr, abi: pricedSubregistryAbi, functionName: 'paidAt', args: [node] }).catch(() => 0n),
    ]);
    if ((paid as bigint) > 0n) purchase = { coins: coinsOf(paid as bigint, chain.coin.decimals), coin: chain.coin.symbol, at: Number(at) };
  }
  return blank({
    ...base, status: 'registered', agent, displayName: (records.displayName as string | undefined) ?? null, owner, ownerName, presented, presentsThis,
    declared: declared ? { agentType: declared.agentType, noun: declared.agentType ? NOUN[declared.agentType] ?? null : null, serviceRole: declared.serviceRole, agentKind: declared.agentKind, agentSubtype: declared.agentSubtype } : null,
    typeCheck, records: recordRows(records), signals, banners,
    can: capabilities({ name: p.normalized, tld, owner, ownerName, agent, presented, subregistry: sub, open, priced: !!sub && chain.pricedSet.has(sub), legacy: !!p.legacy }),
    children: kids.rows, childCount: Number(childCount), details: details(records), purchase,
  });
}

function safeHost(url: string): string { try { return new URL(url).host; } catch { return url; } }

// ── an address ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function addressView(ctx: Ctx, address: Address): Promise<AddressView> {
  const { chain } = ctx;
  const a = lower(address);
  // Every root's open subregistry records one claim per agent: ask each what this address claimed.
  const subs = (await rootViews(ctx)).filter((r) => r.open && r.subregistry).map((r) => [r.tld, r.subregistry!] as const);
  const [s, code, presentedRaw, primaryNode, declared, claims] = await Promise.all([
    stamp(ctx), chain.client.getCode({ address: a }), chain.ur<string>('reverseResolveString', [a]), chain.reg<Hex>('primaryName', [a]),
    chain.naming.readDerivedType(a), Promise.all(subs.map(([, sub]) => chain.sub<Hex>(sub, 'claimedBy', [a]))),
  ]);
  const heldNodes = subs.map(([tld], i) => ({ tld, node: claims[i]! })).filter((x) => x.node !== ZERO_NODE);
  const [heldNames, primaryRaw] = await Promise.all([
    Promise.all(heldNodes.map((x) => chain.ur<string>('nameOf', [x.node]))),
    primaryNode !== ZERO_NODE && !presentedRaw ? chain.ur<string>('nameOf', [primaryNode]) : Promise.resolve(''),
  ]);
  const presented = presentedRaw ? displayOf(presentedRaw) : null;
  // Two keys of the deployment can name the same subregistry (a legacy alias); a name is listed once.
  const seen = new Set<string>();
  const held = heldNodes.map((x, i) => ({ onChain: heldNames[i] ?? '' })).filter((x) => x.onChain && !seen.has(x.onChain) && !!seen.add(x.onChain))
    .map((x) => { const name = displayOf(x.onChain); const tld = x.onChain.split('.').pop() ?? ''; return { tld, name, presented: name === presented, kind: kindOfName(name) }; });
  const isAccount = !!code && code !== '0x';
  const banners: Banner[] = [];
  if (!isAccount) banners.push({ tone: 'warn', title: 'Not a Smart Agent', body: 'There is no account at this address on this chain. It may be a key. Names point at agents, never at the keys that sign for them.' });
  if (!presented && primaryRaw) banners.push({ tone: 'warn', title: 'Its presented name does not point back', body: `This address set ${displayOf(primaryRaw)} as its presented name, but that name does not resolve to it. Nobody should show that name for this address.` });
  else if (!presented && held.length) banners.push({ tone: 'info', title: 'It presents no name', body: 'This agent holds a name but has not set one as its own. Apps that follow the display rule show its address.' });
  return {
    ...s, address: a, isAccount, presented,
    declared: { agentType: declared.agentType, noun: declared.agentType ? NOUN[declared.agentType] ?? null : null, serviceRole: declared.serviceRole, agentKind: declared.agentKind, agentSubtype: declared.agentSubtype },
    kind: kindOfType(declared.agentType), names: declared.agentType ? NOUN[declared.agentType] ?? null : null, held, banners, estates: estatesOf(ctx.town),
  };
}

/** THE display rule (spec 430 D7): the name to show for an address, or nothing. One view call, checked on chain. */
export async function displayView(ctx: Ctx, address: Address): Promise<DisplayView> {
  const a = lower(address);
  const [s, raw] = await Promise.all([stamp(ctx), ctx.chain.ur<string>('reverseResolveString', [a])]);
  return { ...s, address: a, name: raw ? displayOf(raw) : null };
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function labelRefusal(label: string): { rule: string; detail: string } | null {
  if (!label) return { rule: 'empty', detail: RULE_WORDS.empty! };
  if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-') || label.length > 63) return { rule: 'charset', detail: RULE_WORDS.charset! };
  if (label.length < 3) return { rule: 'label_too_short', detail: RULE_WORDS.label_too_short! };
  if (new Set<string>(RESERVED_LABELS as Iterable<string>).has(label)) return { rule: 'reserved_label', detail: RULE_WORDS.reserved_label! };
  return null;
}

export async function searchView(ctx: Ctx, query: string): Promise<SearchView> {
  const { chain, town } = ctx;
  const s = await stamp(ctx);
  let q = query.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!q) return { ...s, kind: 'invalid', rule: 'empty', detail: RULE_WORDS.empty! };
  if (isAddress(q)) return { ...s, kind: 'address', address: q as Address };
  if (/^0x/.test(q)) return { ...s, kind: 'invalid', rule: 'address', detail: 'That looks like an address, but an address is 0x and forty hex characters.' };
  // An agent's DNS host in one of the town's estates: `<label>-<type>.<zone>` or `<label>.<zone>`.
  for (const e of town.estates) {
    if (e.agentZone && q.endsWith(`.${e.agentZone}`)) {
      const rest = q.slice(0, -(e.agentZone.length + 1));
      if (rest && !rest.includes('.')) q = typedNameForLabel(rest) ?? rest;
    }
  }
  if (q.includes('.') || q.includes('@')) {
    try {
      const p = parseAgentName(q);
      if (p.kind === 'root') return { ...s, kind: 'root', tld: p.normalized };
      return { ...s, kind: 'name', name: p.normalized };
    } catch (e) { return { ...s, kind: 'invalid', ...refusal(e) }; }
  }
  const roots = await rootViews(ctx);
  if (roots.some((r) => r.tld === q)) return { ...s, kind: 'root', tld: q };
  const bad = labelRefusal(q);
  if (bad) return { ...s, kind: 'invalid', ...bad };
  const facts = await Promise.all(roots.map((r) => {
    const node = namehash(`${q}.${r.tld}`) as Hex;
    return Promise.all([chain.reg<boolean>('recordExists', [node]), chain.reg<Address>('owner', [node]), chain.reg<boolean>('isExpired', [node]), chain.ur<Address>('resolveName', [node])]);
  }));
  const rows: SearchRow[] = roots.map((r, i) => {
    const [exists, owner, expired, target] = facts[i]!;
    const status: SearchRow['status'] = exists ? 'registered' : nz(owner) && expired ? 'expired' : 'available';
    let coins: number | null = null;
    if (r.priced) { try { coins = priceOf(q, r.tld); } catch { coins = null; } }
    const by = status === 'registered' ? '' : r.priced ? `${r.names ?? 'an agent'}’s agent could buy it from its Home${coins !== null ? ` for ${coins} ${chain.coin?.symbol ?? 'SHQ'}` : ''}` : r.open ? `${r.names ?? 'an agent'}’s agent could claim it, from its Home` : 'not open to claim';
    return { name: `${q}.${r.tld}`, tld: r.tld, names: r.names, kind: r.kind, status, agent: exists ? nz(target) : null, by, coins };
  });
  return { ...s, kind: 'label', label: q, rows };
}
