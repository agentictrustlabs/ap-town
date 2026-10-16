// The naming service's answers (spec 430 §3–§4), assembled from chain reads. Everything here is a READ of public
// state; nothing is stored, signed or granted. Each view states what the contracts check and no more.
import {
  AGENT_TLDS, LEGACY_TLDS, RESERVED_LABELS, namehash, parseAgentName, priceOf, pricedSubregistryAbi,
  typedNameForLabel, validateTypedClaim, type ParsedAgentName,
} from '@agenticprimitives/agent-naming';
import { TOWNS, placeAgent, type TownManifest } from '@ap-town/town-model';
import { concat, isAddress, keccak256 } from 'viem';
import type {
  Address, AddressView, Banner, CanRow, ClaimedElsewhere, DisplayView, EstateOfAgent, EstateRef, Hex, NameRow, NameView, RecordRow,
  RootPage, RootView, SearchRow, SearchView, Signal, Stamp, TownView,
} from '../src/api-types';
import type { PlaceKind } from '@ap-town/town-scene';
import { ZERO, ZERO_NODE, type Chain } from './chain';
import type { Peer } from './peers';
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
  /** The other towns' naming services (spec 440 §C5's road). Empty when this build knows no other town. */
  peers: Peer[];
  /** The ROOT town's naming service when this town's names are rooted elsewhere (`chain.namesRootedAt`); null on a root. */
  root: Peer | null;
}

const lower = (a: string): Address => a.toLowerCase() as Address;
const nz = (a: string | null | undefined): Address | null => (a && a !== ZERO ? lower(a) : null);

export const estatesOf = (town: TownManifest): EstateRef[] => town.estates.map((e) => ({ id: e.id, home: e.home, naming: `${e.home.replace(/\/$/, '')}/naming` }));

/** `keccak256("atl:estate")` / `keccak256("atl:homepage")` — the two profile predicates this read uses. */
const ATL_ESTATE = keccak256(new TextEncoder().encode('atl:estate'));
const ATL_HOMEPAGE = keccak256(new TextEncoder().encode('atl:homepage'));

/**
 * WHICH ESTATE AN AGENT BELONGS TO, in two calls and no history.
 *
 * A chain carries more than one estate, and they share these contracts — so two people named under the
 * same root can belong to different Homes, and sending someone to the wrong one does not fail: it mints a
 * different Smart Agent for their credential under that estate's custody root. The agent therefore SAYS
 * which estate is its own (`atl:estate`, the estate agent's NAME — stable), and that estate agent says
 * where its Home is today (`atl:homepage` — movable). Both are plain `eth_call` reads of public profile
 * state: no log scan (ADR-0012), no index between this answer and the chain.
 *
 * An agent that declares nothing gets `null`. That is the honest answer and the only safe one — the town
 * manifest is consulted ONLY to put a local id on a name the chain already gave, never to guess an estate
 * for an agent that named none.
 */
export async function estateOfAgent(ctx: Ctx, agent: Address | null): Promise<EstateOfAgent | null> {
  if (!agent) return null;
  try { return await readEstateOfAgent(ctx, agent); } catch { return null; }
}
async function readEstateOfAgent(ctx: Ctx, agent: Address): Promise<EstateOfAgent | null> {
  const name = (await ctx.chain.profile<string>('getStringProperty', [agent, ATL_ESTATE]).catch(() => '')).trim();
  if (!name) return null;
  // The estate the agent names may live in ANOTHER town (impact-agent moved to hopenet and its agent on this chain still
  // says `imbnet.estate`), so every town's manifest is asked, not only this one's; the manifest supplies the id and the
  // town, the chain supplies the name and the Home.
  const known = Object.values(TOWNS).flatMap((t) => t.estates).find((e) => e.estateName?.toLowerCase() === name.toLowerCase()) ?? ctx.town.estates.find((e) => e.estateName?.toLowerCase() === name.toLowerCase());
  // NAMEHASHED HERE, not by the naming package: its `namehash` validates the suffix against the TLDs it
  // knows and throws `unknown_tld` for a root added after that package was published — which is every
  // new root, including `.estate`. A node is keccak over the labels and nothing else; what the agent
  // DECLARED is the fact being reported, and this read must not depend on a package's root list.
  const node = name.split('.').reverse().reduce<Hex>((acc, label) => keccak256(concat([acc, keccak256(new TextEncoder().encode(label))])) as Hex, `0x${'0'.repeat(64)}` as Hex);
  const estateAgent = nz(await ctx.chain.ur<Address>('resolveName', [node]).catch(() => ZERO));
  const home = estateAgent ? (await ctx.chain.profile<string>('getStringProperty', [estateAgent, ATL_HOMEPAGE]).catch(() => '')).trim() : '';
  return { name, id: known?.id ?? null, home: home || null, agent: estateAgent };
}

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

/**
 * The town's roots as shown: the TYPED ones. The legacy roots (`.impact`, `.agent`) are closed and say nothing about
 * what an agent is, so they are not viewed (owner, 2026-10-06) — not on the home page, the search, or as root pages. A
 * legacy NAME still answers on its own page, because it resolves, with its banner; an agent's held names still list it.
 */
export async function rootViews(ctx: Ctx): Promise<RootView[]> {
  const nodes = await ctx.chain.reg<Hex[]>('getRoots');
  const views = await Promise.all(nodes.map((n) => rootViewOf(ctx, n)));
  return views.filter((v) => !v.legacy).sort((a, b) => rootRank(a.tld) - rootRank(b.tld) || a.tld.localeCompare(b.tld));
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

export async function townViewLocal(ctx: Ctx): Promise<TownView> {
  const [s, roots] = await Promise.all([stamp(ctx), rootViews(ctx)]);
  const samples = await Promise.all(roots.map((r) => (r.count ? rowsUnder(ctx, r.tld, 0, SAMPLE).then((x) => x.rows) : Promise.resolve([]))));
  let fees: TownView['fees'] = null;
  if (ctx.chain.feeTreasury && ctx.chain.coin) {
    const bal = await ctx.chain.client.readContract({ address: ctx.chain.coin.address, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [ctx.chain.feeTreasury] }).catch(() => 0n);
    fees = { treasury: ctx.chain.feeTreasury, coin: ctx.chain.coin.symbol, coins: coinsOf(bal as bigint, ctx.chain.coin.decimals) };
  }
  return { ...s, estates: estatesOf(ctx.town), fees, roots: roots.map((r, i) => ({ ...r, sample: samples[i] ?? [] })), total: roots.reduce((n, r) => n + r.count, 0) };
}

export async function rootPageLocal(ctx: Ctx, tld: string, page: number): Promise<RootPage | null> {
  const t = tld.toLowerCase();
  if (!/^[a-z0-9-]{1,63}$/.test(t)) return null;
  const node = await ctx.chain.reg<Hex>('rootByLabel', [t]);
  if (node === ZERO_NODE) return null;
  const p = Math.max(1, Math.floor(page) || 1);
  const [s, root, list] = await Promise.all([stamp(ctx), rootViewOf(ctx, node), rowsUnder(ctx, t, (p - 1) * PAGE_SIZE, PAGE_SIZE)]);
  if (root.legacy) return null; // not viewed (see rootViews)
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

export async function nameViewLocal(ctx: Ctx, input: string): Promise<NameView> {
  const { chain, town } = ctx;
  const s = await stamp(ctx);
  const estates = estatesOf(town);
  const raw = input.trim();
  const blank = (over: Partial<NameView>): NameView => ({
    ...s, input: raw, status: 'invalid', name: raw.toLowerCase(), onChainName: raw.toLowerCase(), form: 'canonical', tld: null, kind: 'legacy', names: null,
    legacy: false, node: ZERO_NODE, agent: null, displayName: null, owner: null, ownerName: null, presented: null, presentsThis: false, declared: null,
    typeCheck: null, records: [], signals: null, banners: [], can: [], children: [], childCount: 0, details: null, availability: null, price: null, purchase: null, identity: null, estate: null, estates, ...over,
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
    // A name just claimed and not yet presented has a resolver and no records; the package's reader throws on the
    // empty answer. That is "no records", not an error — the page must show the fresh name, not a crash.
    (chain.naming.getRecords(p.onChainName) as Promise<Record<string, unknown>>).catch(() => ({} as Record<string, unknown>)),
    agent ? chain.naming.readDerivedType(agent).catch(() => null) : Promise.resolve(null),
    agent ? chain.ur<string>('reverseResolveString', [agent]) : Promise.resolve(''),
    owner && owner !== agent ? chain.ur<string>('reverseResolveString', [owner]) : Promise.resolve(null),
    Number(childCount) ? rowsUnder(ctx, p.onChainName, 0, CHILD_CAP) : Promise.resolve({ rows: [], total: 0 }),
    agent ? ctx.listed(agent) : Promise.resolve(false),
  ]);
  // Two more calls, batched with the rest of the page's reads by the transport.
  const estate = await estateOfAgent(ctx, agent);
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
      let v: ReturnType<typeof validateTypedClaim> = [];
      try { v = validateTypedClaim({ name: p, subject: { agentType: declared.agentType, serviceRole: declared.serviceRole, nameKind: (records.agentKind as never) ?? null, agentSubtype: declared.agentSubtype } }).filter((x) => x.code !== 'label_reads_as_type'); } catch (e) { v = [{ code: 'type_undeclared', detail: String((e as Error).message ?? e) } as never]; }
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
  const identity = identityOf({ chainId: town.chain.id, agent, records, declaredEstate: estate, name: p.normalized });
  if (identity.here?.role === 'satellite') banners.push({ tone: 'info', title: 'Not the agent’s home account', body: `On this chain the name points at the agent’s account here, which holds the name on the root chain. The agent IS ${identity.canonical}${identity.canonicalTown ? ` (the ${identity.canonicalTown} town)` : ''}: that is its canonical id, and its Home and custody live there.` });
  else if (identity.here && identity.here.role === 'undeclared') banners.push({ tone: 'info', title: 'Which account is the agent’s home is not declared', body: 'The name points at an account on this chain and lists no home account (atl:nativeId). Nothing here should be read as the agent’s canonical id until the agent declares it.' });
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
    children: kids.rows, childCount: Number(childCount), details: details(records), purchase, estate, identity,
  });
}

function safeHost(url: string): string { try { return new URL(url).host; } catch { return url; } }

// ── WHO THIS NAME IS A NAME OF (owner, 2026-10-15) ───────────────────────────────────────────────────────────────────
// A name is a PROJECTION of an agent's identity, never the identity. The identity is the agent's canonical id — its HOME
// account as CAIP-10, the one its Home and custody live on, declared on the name as `atl:nativeId` (spec 440 §C3, Ring 0
// spec 346 §3.8). The account this name points at ON THIS CHAIN is the agent's account HERE: on the root chain that is a
// SATELLITE holding the root name, and it is not the canonical id however much the root chain invites the thought.
// `atl:accounts` lists the agent's account on every chain; this block says which of them is home. When nothing says,
// it says that — it never promotes this chain's account to canonical by default.
export type AccountRole = 'home' | 'satellite' | 'undeclared';
export interface IdentityAccount { account: string; chainId: number; town: string | null; role: AccountRole; here: boolean }
export interface NameIdentity {
  /** The agent's canonical id (CAIP-10 of its home account), or null when the name does not declare one. */
  canonical: string | null;
  canonicalChainId: number | null;
  canonicalTown: string | null;
  /** The account this name points at on THIS chain, and what it is to the agent. */
  here: IdentityAccount | null;
  /** The agent's account on every chain the name lists, this chain's included. */
  accounts: IdentityAccount[];
  /** The estate (and its Home) the AGENT belongs to: declared on the agent (`atl:estate`), else placed by its own endpoint against the towns' manifests. */
  estate: { id: string | null; name: string | null; home: string | null; town: string | null; how: 'declared' | 'placed' } | null;
}
const townOfChain = (chainId: number): string | null => Object.values(TOWNS).find((t) => t.chain.id === chainId)?.town ?? null;
const caip10 = (chainId: number, address: string): string => `eip155:${chainId}:${address.toLowerCase()}`;
export function identityOf(args: { chainId: number; agent: Address | null; records: Record<string, unknown>; declaredEstate: EstateOfAgent | null; name: string }): NameIdentity {
  const { chainId, agent, records } = args;
  const nativeId = typeof records.nativeId === 'string' && /^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(records.nativeId) ? records.nativeId.toLowerCase() : null;
  const canonicalChainId = nativeId ? Number(nativeId.split(':')[1]) : null;
  const roleOf = (account: string): AccountRole => (nativeId ? (account.toLowerCase() === nativeId ? 'home' : 'satellite') : 'undeclared');
  const row = (account: string): IdentityAccount => { const cid = Number(account.split(':')[1]); return { account: account.toLowerCase(), chainId: cid, town: townOfChain(cid), role: roleOf(account), here: cid === chainId }; };
  const listed = (Array.isArray(records.accounts) ? (records.accounts as unknown[]).filter((a): a is string => typeof a === 'string' && /^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(a)) : []).map(row);
  const here = agent ? row(caip10(chainId, agent)) : null;
  const accounts = here && !listed.some((a) => a.here) ? [here, ...listed] : listed;
  // The estate: what the agent declares wins; else the towns' manifests place its endpoint (an inference, and said so).
  let estate: NameIdentity['estate'] = null;
  if (args.declaredEstate?.id || args.declaredEstate?.home) estate = { id: args.declaredEstate.id, name: args.declaredEstate.name, home: args.declaredEstate.home, town: null, how: 'declared' };
  else if (agent && typeof records.a2aEndpoint === 'string') {
    for (const t of Object.values(TOWNS)) {
      const placed = placeAgent({ name: args.name, smartAgent: agent, a2aEndpoint: records.a2aEndpoint }, t);
      if (placed.estate) { const e = t.estates.find((x) => x.id === placed.estate); estate = { id: placed.estate, name: e?.estateName ?? null, home: e?.home ?? null, town: t.town, how: 'placed' }; break; }
    }
  }
  if (estate && !estate.town && estate.id) estate.town = Object.values(TOWNS).find((t) => t.estates.some((e) => e.id === estate!.id))?.town ?? null;
  return { canonical: nativeId, canonicalChainId, canonicalTown: canonicalChainId ? townOfChain(canonicalChainId) : null, here, accounts, estate };
}

// ── an address ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function addressView(ctx: Ctx, address: Address): Promise<AddressView> {
  const { chain } = ctx;
  const a = lower(address);
  // Every subregistry that ever fronted a root records one claim per agent: the root's current one (priced or open)
  // and the open ones from before the switch (spec 431 W4) — a name claimed then is still held now.
  const roots = await rootViews(ctx);
  const subs: Array<readonly [string, Address]> = [];
  const seenSub = new Set<string>();
  const add = (tld: string, a: Address | null | undefined) => { if (a && !seenSub.has(a.toLowerCase())) { seenSub.add(a.toLowerCase()); subs.push([tld, a.toLowerCase() as Address]); } };
  for (const r of roots) add(r.tld, r.subregistry);
  for (const [tld, a] of Object.entries(chain.subregistries)) add(tld, a);
  for (const a of chain.open) add('', a);
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
  // AN ACCOUNT ON ANOTHER CHAIN. "No account at this address on this chain" was read as "not an agent" — wrong for a person's
  // canonical id, which lives on her home chain while this chain's name points at her satellite. So every OTHER town's
  // registry is asked (its public `/agent?key=`, on its own zone) whether it lists the address, and the page says where it is.
  // A listing elsewhere is a fact about that town's graph, nothing more; the name it reports is that town's.
  const elsewhere = await Promise.all(Object.values(TOWNS).filter((t) => t.town !== ctx.town.town).map(async (t) => {
    const host = t.services.find((s) => s.id === 'registry')?.hosts[0];
    if (!host) return null;
    try {
      const r = await fetch(`https://${host}/agent?key=${a}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const body = (await r.json()) as { ok?: boolean; triples?: Array<{ p: string; o: string }> };
      if (!body.ok || !Array.isArray(body.triples) || !body.triples.length) return null;
      const val = (p: string) => body.triples!.find((x) => x.p === p)?.o ?? null;
      return { town: t.town, chainId: t.chain.id, name: val('https://agenticprimitives.dev/ns/naming#name'), displayName: val('https://agenticprimitives.dev/ns/profile#displayName'), registry: `https://${host}` };
    } catch { return null; }
  })).then((rows) => rows.filter((x): x is NonNullable<typeof x> => !!x));
  // WHO THIS ACCOUNT IS: read off the name it presents (nativeId, accounts, endpoint) and what it declares (atl:estate) —
  // the same block the name page leads with, so an address is never shown as if it were the agent's canonical id by itself.
  const [presentedRecords, declaredEstate] = await Promise.all([
    presentedRaw ? (chain.naming.getRecords(presentedRaw) as Promise<Record<string, unknown>>).catch(() => ({} as Record<string, unknown>)) : Promise.resolve({} as Record<string, unknown>),
    isAccount ? estateOfAgent(ctx, a) : Promise.resolve(null),
  ]);
  const identity = isAccount ? identityOf({ chainId: ctx.town.chain.id, agent: a, records: presentedRecords, declaredEstate, name: presented ?? '' }) : null;
  const banners: Banner[] = [];
  if (identity?.here?.role === 'satellite') banners.push({ tone: 'info', title: 'Not the agent’s home account', body: `This is the agent’s account on this chain, which holds its name here. The agent IS ${identity.canonical}${identity.canonicalTown ? ` (the ${identity.canonicalTown} town)` : ''}: that is its canonical id, and its Home and custody live there.` });
  if (!isAccount && elsewhere.length) banners.push({ tone: 'info', title: `An account on another chain`, body: `There is no account at this address on this chain (eip155:${ctx.town.chain.id}). ${elsewhere.map((e) => `On ${e.town} (eip155:${e.chainId}) it is ${e.name ?? 'listed'}${e.displayName ? ` — ${e.displayName}` : ''}`).join('; ')}. A name on this chain that points at this person points at her account HERE; this address is her canonical id where she lives.` });
  else if (!isAccount) banners.push({ tone: 'warn', title: 'Not a Smart Agent', body: 'There is no account at this address on this chain, and no other town in the federation lists it. It may be a key. Names point at agents, never at the keys that sign for them.' });
  if (!presented && primaryRaw) banners.push({ tone: 'warn', title: 'Its presented name does not point back', body: `This address set ${displayOf(primaryRaw)} as its presented name, but that name does not resolve to it. Nobody should show that name for this address.` });
  else if (!presented && held.length) banners.push({ tone: 'info', title: 'It presents no name', body: 'This agent holds a name but has not set one as its own. Apps that follow the display rule show its address.' });
  return {
    ...s, address: a, isAccount, presented,
    declared: { agentType: declared.agentType, noun: declared.agentType ? NOUN[declared.agentType] ?? null : null, serviceRole: declared.serviceRole, agentKind: declared.agentKind, agentSubtype: declared.agentSubtype },
    kind: kindOfType(declared.agentType), names: declared.agentType ? NOUN[declared.agentType] ?? null : null, held, banners, identity, elsewhere, estates: estatesOf(ctx.town),
  };
}

/** THE display rule (spec 430 D7): the name to show for an address, or nothing. One view call, checked on chain. */
export async function displayView(ctx: Ctx, address: Address): Promise<DisplayView> {
  const a = lower(address);
  const [s, raw] = await Promise.all([stamp(ctx), ctx.chain.ur<string>('reverseResolveString', [a])]);
  return { ...s, address: a, name: raw ? displayOf(raw) : null };
}

/** What a treasury holds of the naming coin — the buyer's side of the price (430 N6: the register page's "paid from"). */
export async function coinsView(ctx: Ctx, address: Address): Promise<Stamp & { address: string; coin: string | null; coins: number | null }> {
  const s = await stamp(ctx);
  if (!ctx.chain.coin) return { ...s, address: lower(address), coin: null, coins: null };
  const bal = await ctx.chain.client.readContract({ address: ctx.chain.coin.address, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [address] }).catch(() => 0n);
  return { ...s, address: lower(address), coin: ctx.chain.coin.symbol, coins: coinsOf(bal as bigint, ctx.chain.coin.decimals) };
}

/** Many agents' presented names in one read (≤ 50): what each shows as its own, or null. For a person's own list. */
export async function displayManyView(ctx: Ctx, addresses: Address[]): Promise<Stamp & { names: Record<string, string | null> }> {
  const uniq = [...new Set(addresses.map(lower))].slice(0, 50);
  const [s, raws] = await Promise.all([stamp(ctx), Promise.all(uniq.map((a) => ctx.chain.ur<string>('reverseResolveString', [a]).catch(() => '')))]);
  const names: Record<string, string | null> = {};
  uniq.forEach((a, i) => { names[a] = raws[i] ? displayOf(raws[i]!) : null; });
  return { ...s, names };
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function labelRefusal(label: string): { rule: string; detail: string } | null {
  if (!label) return { rule: 'empty', detail: RULE_WORDS.empty! };
  if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-') || label.length > 63) return { rule: 'charset', detail: RULE_WORDS.charset! };
  if (label.length < 3) return { rule: 'label_too_short', detail: RULE_WORDS.label_too_short! };
  if (new Set<string>(RESERVED_LABELS as Iterable<string>).has(label)) return { rule: 'reserved_label', detail: RULE_WORDS.reserved_label! };
  return null;
}

export async function searchViewLocal(ctx: Ctx, query: string): Promise<SearchView> {
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

// ── names that CONTAIN what you typed ────────────────────────────────────────────────────────────────────────
//
// The box asked one question — "is `nath.me` free?" — and so typing part of a name you were looking for answered
// about a name nobody has (owner, 2026-10-14). Finding `nathan.me` from `nath` is a different question, and this
// is it.
//
// FROM CHAIN STORAGE, like everything else here (ADR-0012): the registry contract hands back every child
// labelhash under a root, each label is read from storage, and the match is a plain substring over those labels.
// No log scan and no index of our own — the reads batch forty to an HTTP request, so the whole town is a handful
// of calls. The answer is CACHED for a few minutes because it is a browse aid; whether a particular name is free
// is asked uncached, every time, and that is the answer anyone acts on.
export interface LabelHit { name: string; label: string; tld: string; kind: PlaceKind; names: string | null; /** Set when the hit comes from another chain's LOCAL table, not the chain of record. */ town?: string }
export type NamesLikeView = Stamp & { label: string; tld: string | null; hits: LabelHit[]; total: number; scanned: number };

const LABELS_TTL_S = 600;
/** Labels read per HTTP batch. The client packs forty calls into one request; asking for every label at once
 *  therefore put eight requests on the gateway in the same instant, and the first time it ran, a reader asking
 *  the ordinary question — "is this name free?" — got a 502 out of the gateway instead of an answer. One batch in
 *  flight at a time is a few seconds cold, once every ten minutes, and nobody else's read pays for it. */
const LABEL_CHUNK = 40;

/** Every registered label under every typed root, from the chain, cached at the edge. */
async function allLabels(ctx: Ctx): Promise<LabelHit[]> {
  const key = new Request(`https://naming.internal/labels/${ctx.town.town}`);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return (await hit.json()) as LabelHit[];
  const roots = (await rootViews(ctx)).filter((r) => !r.legacy);
  // One batched pass for the child lists, then the labels in chunks — never the whole town at once.
  const childLists = await Promise.all(roots.map((r) => ctx.chain.reg<Hex[]>('childLabelhashes', [namehash(r.tld) as Hex]).catch(() => [] as Hex[])));
  const wanted = roots.flatMap((r, i) => (childLists[i] ?? []).map((h) => ({ r, node: keccak256(concat([namehash(r.tld) as Hex, h])) as Hex })));
  const all: LabelHit[] = [];
  for (let i = 0; i < wanted.length; i += LABEL_CHUNK) {
    const chunk = wanted.slice(i, i + LABEL_CHUNK);
    const labels = await Promise.all(chunk.map((w) => ctx.chain.reg<string>('label', [w.node]).catch(() => '')));
    labels.forEach((label, j) => { const w = chunk[j]!; if (label) all.push({ name: displayOf(`${label}.${w.r.tld}`), label, tld: w.r.tld, kind: w.r.kind, names: w.r.names }); });
  }
  await cache?.put(key, new Response(JSON.stringify(all), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${LABELS_TTL_S}` } })).catch(() => undefined);
  return all;
}

/**
 * Names containing `q`, the ones that START with it first, then the rest — each group alphabetical so the order
 * is a property of the names and not of the order the chain happens to hold them in. A type filter is a hard
 * filter here as everywhere: it removes, it never re-orders.
 */
export async function namesLikeLocal(ctx: Ctx, query: string, tld: string | null, limit = 60): Promise<NamesLikeView> {
  const s = await stamp(ctx);
  const q = query.trim().toLowerCase();
  if (q.length < 2 || !/^[a-z0-9-]{2,63}$/.test(q)) return { ...s, label: q, tld, hits: [], total: 0, scanned: 0 };
  // A browse aid never costs anyone an answer: if the scan cannot be finished, this says it found nothing rather
  // than failing the request that carries the availability answer beside it.
  const all = await allLabels(ctx).catch(() => [] as LabelHit[]);
  const pool = tld ? all.filter((h) => h.tld === tld) : all;
  const starts = pool.filter((h) => h.label.startsWith(q)).sort((a, b) => a.label.localeCompare(b.label) || a.tld.localeCompare(b.tld));
  const inside = pool.filter((h) => !h.label.startsWith(q) && h.label.includes(q)).sort((a, b) => a.label.localeCompare(b.label) || a.tld.localeCompare(b.tld));
  const hits = [...starts, ...inside];
  return { ...s, label: q, tld, hits: hits.slice(0, limit), total: hits.length, scanned: all.length };
}

// ── ONE NAMESPACE, ONE ROOT (ap-federation spec 440 §C) ──────────────────────────────────────────────────────────
//
// The readers above answer from THIS chain. A chain is one of two things to the namespace: the ROOT, whose registry is
// the record of every typed name, or a LOCAL TABLE on a chain whose names are rooted elsewhere (`chain.namesRootedAt`).
// The exported views below are what the API serves, and they put each chain in its place:
//
//   • A town rooted elsewhere asks the ROOT town for "does it exist / is it free" (every answer carries `rootedAt`), and
//     shows its own table only as `local` — "on this chain" — never as availability. Before this (2026-10-16),
//     names.hopenet.town read its table as a root and offered `alice.me`, registered on the root since the first town.
//   • The root, whose chain says a name is free, asks the OTHER towns' tables whether a Home there claimed it. Until
//     wave U3 carries such a claim to the root, that is where `rich-impact.me` is — and the root's page says so,
//     as `claimedElsewhere`, instead of listing it for sale.
//
// Peers are asked with `?local=1`, which answers from the table alone, so a root asking a rooted town never comes back
// around to the root. A peer that cannot be asked is `null` in the answer ("could not be asked"), never "nowhere"; a
// ROOT that cannot be asked is an error, because a rooted town has no other honest answer (ADR-0013).

const rootUnreachable = (ctx: Ctx, why: string): Error => new Error(`names here are rooted at ${ctx.root!.town}, whose naming service could not be asked — ${why}`);

/** This town's stamp over the root's answer: our chain and block, and the root's as `rootedAt`. */
async function rootedStamp(ctx: Ctx, rootAnswer: Stamp): Promise<Stamp> {
  const s = await stamp(ctx);
  return { ...s, rootedAt: { town: rootAnswer.town, chainId: rootAnswer.chainId, block: rootAnswer.block, host: ctx.root!.host } };
}

async function fromRoot<T extends Stamp>(ctx: Ctx, path: string): Promise<T> {
  const r = await ctx.root!.get<T>(path);
  if (!r.ok) throw rootUnreachable(ctx, r.error);
  return { ...r.data, ...(await rootedStamp(ctx, r.data)) };
}

/** On a root: which other towns' tables hold `name`. `null` when any peer could not be asked. */
async function claimedElsewhereOf(ctx: Ctx, name: string): Promise<ClaimedElsewhere[] | null> {
  if (!ctx.peers.length) return [];
  const answers = await Promise.all(ctx.peers.map((p) => p.get<NameView>(`/name/${encodeURIComponent(name)}?local=1`)));
  if (answers.some((a) => !a.ok)) return null;
  return answers.flatMap((a, i) => (a.ok && a.data.status === 'registered' ? [{ town: ctx.peers[i]!.town, chainId: ctx.peers[i]!.chainId, agent: a.data.agent, owner: a.data.owner }] : []));
}

const elsewhereBanner = (rows: ClaimedElsewhere[]): Banner => ({
  tone: 'warn', title: `Claimed on ${rows.map((r) => r.town).join(' and ')}, not on the root`,
  body: `A Home on ${rows.map((r) => `${r.town} (eip155:${r.chainId})`).join(' and ')} wrote this name in that chain's table${rows[0]?.agent ? `, pointing at ${rows[0].agent}` : ''}. A name is one across the federation and its record is this chain's; that claim has not been carried here yet (spec 440 U3), so this chain reads the name as free — it is not, and nobody else should register it here.`,
});

export async function nameView(ctx: Ctx, input: string): Promise<NameView> {
  if (!ctx.root) {
    const v = await nameViewLocal(ctx, input);
    if ((v.status !== 'available' && v.status !== 'expired') || v.form !== 'canonical') return v;
    const claimedElsewhere = await claimedElsewhereOf(ctx, v.name);
    const banners = claimedElsewhere?.length ? [elsewhereBanner(claimedElsewhere), ...v.banners] : claimedElsewhere === null ? [...v.banners, { tone: 'info' as const, title: 'The other towns could not be asked', body: 'Whether a Home on another chain has claimed this name in its own table could not be checked just now. This chain’s answer stands; the federation’s does not yet.' }] : v.banners;
    return { ...v, banners, claimedElsewhere };
  }
  // Rooted elsewhere: the root's answer is the answer; this chain's table is shown beside it, never instead of it.
  const r = await fromRoot<NameView>(ctx, `/name/${encodeURIComponent(input.trim())}`);
  if (r.status === 'invalid' || r.form === 'root') return { ...r, local: null };
  const { chain, town } = ctx;
  const node = r.node;
  const [exists, ownerRaw, target] = await Promise.all([chain.reg<boolean>('recordExists', [node]), chain.reg<Address>('owner', [node]), chain.ur<Address>('resolveName', [node])]);
  const local: NonNullable<NameView['local']> = { town: town.town, chainId: town.chain.id, exists, agent: nz(target), owner: nz(ownerRaw) };
  const banners: Banner[] = [];
  if (r.status === 'registered' && local.exists) {
    const differs = !!local.agent && !!r.agent && local.agent !== r.agent;
    banners.push({
      tone: differs ? 'warn' : 'info', title: differs ? 'This chain’s table points elsewhere' : 'Also in this chain’s table',
      body: `This chain (eip155:${town.chain.id}) has its own entry for ${r.name}${local.agent ? `, pointing at ${local.agent}` : ''}. The root’s record above is the name (spec 440 C10); this entry is a copy a Home on this chain wrote${differs ? ' — and it names a different account than the root does. Readers follow the root.' : '.'}`,
    });
  } else if (r.status !== 'registered' && local.exists) {
    banners.push({
      tone: 'warn', title: 'Claimed only on this chain',
      body: `A Home on ${town.town} wrote ${r.name} in this chain’s table${local.agent ? `, pointing at ${local.agent}` : ''}, which is not the root. On the root (${ctx.root.town}) the name is free: until this claim is carried there (spec 440 U3), another agent could take it on the root, and the root’s record is the one that counts.`,
    });
  }
  const availability = r.status === 'available' && r.availability
    ? { by: `an agent, at a Home on the ${ctx.root.town} town`, rule: `Names are rooted on ${ctx.root.town} (spec 440 §C): a claim made at a Home on this chain lands in this chain’s table only and is not the name. Until a Home here can claim into the root (wave U3), a root name is claimed at a Home on ${ctx.root.town}. There: ${r.availability.rule}` }
    : r.availability;
  return { ...r, availability, banners: [...banners, ...r.banners], local };
}

export async function searchView(ctx: Ctx, query: string): Promise<SearchView> {
  if (ctx.root) return fromRoot<SearchView>(ctx, `/search?q=${encodeURIComponent(query)}`);
  const v = await searchViewLocal(ctx, query);
  if (v.kind !== 'label' || !ctx.peers.length || !v.rows.some((r) => r.status !== 'registered')) return v;
  const answers = await Promise.all(ctx.peers.map((p) => p.get<SearchView>(`/search?q=${encodeURIComponent(v.label)}&local=1`)));
  const anyUnasked = answers.some((a) => !a.ok);
  const rows: SearchRow[] = v.rows.map((row) => {
    if (row.status === 'registered') return row;
    for (const [i, a] of answers.entries()) {
      if (!a.ok || a.data.kind !== 'label') continue;
      const hit = a.data.rows.find((x) => x.name === row.name && x.status === 'registered');
      if (hit) return { ...row, claimedElsewhere: { town: ctx.peers[i]!.town, chainId: ctx.peers[i]!.chainId, agent: hit.agent, owner: null } };
    }
    // Held nowhere else that answered; `null` says a table could not be asked, so "free" is this chain's word only.
    return anyUnasked ? { ...row, claimedElsewhere: null } : row;
  });
  return { ...v, rows };
}

export async function namesLike(ctx: Ctx, query: string, tld: string | null, limit = 60): Promise<NamesLikeView> {
  const q = `/names-like?q=${encodeURIComponent(query)}${tld ? `&tld=${encodeURIComponent(tld)}` : ''}&local=1`;
  // The chain of record first; then every other table, each hit saying whose table it is. A table that cannot be
  // asked contributes nothing — a browse aid never costs anyone the answer beside it.
  const [record, others] = await Promise.all([
    ctx.root ? fromRoot<NamesLikeView>(ctx, q) : namesLikeLocal(ctx, query, tld, limit),
    Promise.all([
      ...(ctx.root ? [namesLikeLocal(ctx, query, tld, limit).then((v) => ({ town: ctx.town.town, hits: v.hits })).catch(() => ({ town: ctx.town.town, hits: [] as LabelHit[] }))] : []),
      ...ctx.peers.filter((p) => p !== ctx.root).map((p) => p.get<NamesLikeView>(q).then((a) => ({ town: p.town, hits: a.ok ? a.data.hits : [] }))),
    ]),
  ]);
  const seen = new Set(record.hits.map((h) => h.name));
  const extra = others.flatMap((o) => o.hits.filter((h) => !seen.has(h.name) && seen.add(h.name)).map((h) => ({ ...h, town: o.town })));
  const hits = [...record.hits, ...extra];
  return { ...record, hits: hits.slice(0, limit), total: hits.length };
}

export async function townView(ctx: Ctx): Promise<TownView> {
  return ctx.root ? fromRoot<TownView>(ctx, '/town') : townViewLocal(ctx);
}

export async function rootPage(ctx: Ctx, tld: string, page: number): Promise<RootPage | null> {
  if (!ctx.root) return rootPageLocal(ctx, tld, page);
  const r = await ctx.root.get<RootPage | { error: string }>(`/root/${encodeURIComponent(tld)}?page=${page}`);
  if (!r.ok) { if (/ 404 /.test(` ${r.error} `)) return null; throw rootUnreachable(ctx, r.error); }
  if ('error' in r.data) return null;
  return { ...r.data, ...(await rootedStamp(ctx, r.data)) };
}
