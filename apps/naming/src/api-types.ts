// The naming service's read API (spec 430 §4) — the shapes the Worker returns and the app renders. Every answer
// carries the town and the block it was read at: there is no index between this API and the chain.
import type { PlaceKind } from '@ap-town/town-scene';

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** What the agent itself declares on chain. `noun` is the type as a visitor would say it ('a person'). */
export interface Declared { agentType: string | null; noun: string | null; serviceRole: string | null; agentKind: string | null; agentSubtype: string | null }

export interface Stamp { town: string; chainId: number; block: number }

/** One of the four separate signals on a name (spec 430 D5). Never summed, never a score. */
export interface Signal { state: 'yes' | 'no' | 'warn' | 'unknown'; detail: string }

export interface Banner { tone: 'warn' | 'info'; title: string; body: string }

export interface EstateRef { id: string; home: string; naming: string }

export interface RootView {
  tld: string;
  /** What a name under this root is: 'a person', 'an organization', … or null for an untyped (legacy) root. */
  names: string | null;
  kind: PlaceKind;
  legacy: boolean;
  count: number;
  /** Who issues names under the root, in a sentence. */
  issuing: string;
  subregistry: Address | null;
  open: boolean;
  estates: string[];
}

export interface TownView extends Stamp {
  estates: EstateRef[];
  roots: Array<RootView & { sample: NameRow[] }>;
  total: number;
}

export interface NameRow {
  /** Display form (`x.t`, `x.t@c.u`). */
  name: string;
  label: string;
  owner: Address;
  kind: PlaceKind;
}

export interface RootPage extends Stamp {
  root: RootView;
  page: number;
  pages: number;
  pageSize: number;
  names: NameRow[];
  estates: EstateRef[];
}

export interface RecordRow { key: string; label: string; value: string; kind: 'address' | 'url' | 'hash' | 'text' }

export interface CanRow {
  who: string;
  address?: Address;
  name?: string | null;
  note?: string;
  can: string[];
  cannot: string[];
}

export type NameStatus = 'registered' | 'available' | 'expired' | 'invalid' | 'not-claimable';

export interface NameView extends Stamp {
  input: string;
  status: NameStatus;
  /** Why the input is not a name here, in words. */
  invalid?: { rule: string; detail: string };
  name: string;
  onChainName: string;
  form: 'canonical' | 'scoped' | 'legacy' | 'type-node' | 'root';
  tld: string | null;
  kind: PlaceKind;
  /** 'a person', 'an organization', … what the suffix says a name here is. */
  names: string | null;
  legacy: boolean;
  node: Hex;
  /** The agent the name points at. */
  agent: Address | null;
  displayName: string | null;
  owner: Address | null;
  ownerName: string | null;
  /** The name the agent presents as its own (round-trip checked on chain), and whether it is this one. */
  presented: string | null;
  presentsThis: boolean;
  declared: Declared | null;
  typeCheck: { ok: boolean; reason?: string; detail?: string } | null;
  records: RecordRow[];
  signals: { named: Signal; typed: Signal; listed: Signal; reachable: Signal } | null;
  banners: Banner[];
  can: CanRow[];
  children: NameRow[];
  childCount: number;
  details: {
    parent: string;
    resolver: Address | null;
    subregistry: Address | null;
    registeredAt: number | null;
    expiry: number | null;
    hosts: Array<{ estate: string; host: string }>;
  } | null;
  /** For a free name: who could claim it and where. */
  availability: { by: string; rule: string } | null;
  estates: EstateRef[];
}

export interface AddressView extends Stamp {
  address: Address;
  /** True when code is deployed at the address (a Smart Agent); false for a bare key. */
  isAccount: boolean;
  /** The name to show for this address — verified on chain — or null. THE display rule (spec 430 D7). */
  presented: string | null;
  declared: Declared;
  kind: PlaceKind;
  names: string | null;
  /** Every name this agent claimed through a root's open subregistry — one per root. */
  held: Array<{ tld: string; name: string; presented: boolean; kind: PlaceKind }>;
  banners: Banner[];
  estates: EstateRef[];
}

export interface SearchRow { name: string; tld: string; names: string | null; kind: PlaceKind; status: 'registered' | 'available' | 'expired'; agent: Address | null; by: string }

export type SearchView = Stamp & (
  | { kind: 'name'; name: string }
  | { kind: 'address'; address: Address }
  | { kind: 'root'; tld: string }
  | { kind: 'label'; label: string; rows: SearchRow[] }
  | { kind: 'invalid'; rule: string; detail: string }
);

export interface DisplayView extends Stamp { address: Address; name: string | null }

export interface ApiError { error: string; detail?: string }
