// Chain reads for the naming service — `eth_call` only, batched into one HTTP request per page of work, through the
// town's chain gateway with this Worker's own read-only token. No `eth_getLogs` anywhere (ADR-0012); a read that
// fails is an error the caller reports, never a second path (ADR-0013).
import { createPublicClient, http, type PublicClient } from 'viem';
import { AgentNamingClient, agentNameRegistryAbi, agentNameUniversalResolverAbi, permissionlessSubregistryAbi } from '@agenticprimitives/agent-naming';
import { getDeployments } from '@agenticprimitives/contracts/deployments';
import type { TownManifest } from '@ap-town/town-model';
import type { Address, Hex } from '../src/api-types';

export const ZERO: Address = '0x0000000000000000000000000000000000000000';
export const ZERO_NODE: Hex = `0x${'0'.repeat(64)}`;

export interface Chain {
  client: PublicClient;
  naming: AgentNamingClient;
  registry: Address;
  resolver: Address;
  /** Each typed root's open (permissionless) subregistry, by suffix — from the deployment. */
  subregistries: Record<string, Address>;
  /** Every open subregistry's address (lower-case), typed and legacy: the contracts whose rule is "one claim per agent". */
  open: ReadonlySet<Address>;
  /** Spec 431 — each typed root's PRICED subregistry (lower-case), when the deployment has them. */
  priced: Record<string, Address>;
  pricedSet: ReadonlySet<Address>;
  /** The coin names are bought with, and where the fees go. */
  coin: { address: Address; symbol: string; decimals: number } | null;
  feeTreasury: Address | null;
  reg<T>(fn: string, args?: readonly unknown[]): Promise<T>;
  ur<T>(fn: string, args?: readonly unknown[]): Promise<T>;
  sub<T>(address: Address, fn: string, args?: readonly unknown[]): Promise<T>;
}

export function chainFor(town: TownManifest, rpcUrl: string): Chain {
  const d = getDeployments(town.chain.deployment as Parameters<typeof getDeployments>[0]) as unknown as {
    agentNameRegistry: Address; agentNameUniversalResolver: Address; agentProfileResolver: Address;
    permissionlessSubregistries?: Record<string, Address>; permissionlessSubregistry?: Address; permissionlessSubregistryDemoAgent?: Address;
    pricedSubregistries?: Record<string, Address>; namingFeeTreasury?: Address; namingCoin?: { address: Address; symbol: string; decimals: number };
  };
  if (!d?.agentNameRegistry || !d.agentNameUniversalResolver) throw new Error(`no naming contracts in the "${town.chain.deployment}" deployment`);
  const subregistries = Object.fromEntries(Object.entries(d.permissionlessSubregistries ?? {}).map(([k, v]) => [k, v])) as Record<string, Address>;
  // Calls made in the same tick share HTTP requests, forty to a request (the gateway refuses a batch over fifty).
  const client = createPublicClient({ transport: http(rpcUrl, { batch: { batchSize: 40, wait: 8 }, retryCount: 1 }) }) as PublicClient;
  const naming = new AgentNamingClient({ rpcUrl, chainId: town.chain.id, registry: d.agentNameRegistry, universalResolver: d.agentNameUniversalResolver, profileResolver: d.agentProfileResolver, subregistries });
  const read = (address: Address, abi: unknown) => <T,>(fn: string, args: readonly unknown[] = []) =>
    client.readContract({ address, abi: abi as never, functionName: fn as never, args: args as never }) as Promise<T>;
  const open = new Set([...Object.values(subregistries), d.permissionlessSubregistry, d.permissionlessSubregistryDemoAgent].filter((a): a is Address => !!a).map((a) => a.toLowerCase() as Address));
  const priced = Object.fromEntries(Object.entries(d.pricedSubregistries ?? {}).map(([k, v]) => [k, v.toLowerCase() as Address])) as Record<string, Address>;
  const coin = d.namingCoin ?? (town.chain.coin ? { address: town.chain.coin.address as Address, symbol: town.chain.coin.symbol, decimals: town.chain.coin.decimals } : null);
  return {
    client, naming, registry: d.agentNameRegistry, resolver: d.agentNameUniversalResolver, subregistries, open,
    priced, pricedSet: new Set(Object.values(priced)), coin, feeTreasury: d.namingFeeTreasury ? (d.namingFeeTreasury.toLowerCase() as Address) : null,
    reg: read(d.agentNameRegistry, agentNameRegistryAbi),
    ur: read(d.agentNameUniversalResolver, agentNameUniversalResolverAbi),
    sub: (address, fn, args = []) => read(address, permissionlessSubregistryAbi)(fn, args),
  };
}
