// check:town — every town manifest is valid, and every service this repository deploys is what its app says it is:
// the app directory exists, one of its wrangler environments deploys exactly that Worker name, and the hosts the
// manifest lists are the custom domains that environment claims. A manifest that disagrees with the deployables is a
// manifest that lies to the portal (spec 429 D6).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTowns, ROOT } from './load-towns';
import { wranglerFacts } from './wrangler-facts';

const { towns, errors } = loadTowns();
let checked = 0;
for (const town of towns) {
  for (const s of town.services) {
    if (s.repo !== 'ap-town') continue;
    checked++;
    const at = `${town.town}/${s.id}`;
    const toml = join(ROOT, s.app!, 'wrangler.toml');
    if (!existsSync(toml)) { errors.push(`${at}: ${s.app}/wrangler.toml does not exist`); continue; }
    const env = [...wranglerFacts(toml).values()].find((f) => f.name === s.worker);
    if (!env) { errors.push(`${at}: no environment of ${s.app}/wrangler.toml deploys Worker "${s.worker}"`); continue; }
    const routes = new Set(env.routes.map((r) => r.replace(/\/\*$/, '')));
    for (const h of s.hosts) if (!routes.has(h)) errors.push(`${at}: host ${h} is not a route of Worker ${s.worker}`);
    for (const r of routes) if (!s.hosts.includes(r)) errors.push(`${at}: Worker ${s.worker} claims ${r}, which the manifest does not list`);
  }
}
// The declared contract generation is the deployment record's, never a number somebody remembered: a runtime declared
// generation 1 on a chain whose enforcers were deployed at generation 3 saw `BadArgsLength` on every narrow wire. The
// record is the pinned `@agenticprimitives/contracts` release's `deployments-<deployment>.json`; a pin that does not carry
// the chain's record yet is said, not failed — the mismatch is the finding, the absence is a pin to bump.
for (const town of towns) {
  const rec = join(ROOT, 'node_modules', '@agenticprimitives', 'contracts', `deployments-${town.chain.deployment}.json`);
  if (!existsSync(rec)) { console.warn(`check:town — ${town.town}: the pinned @agenticprimitives/contracts carries no deployments-${town.chain.deployment}.json; chain.generation "${town.chain.generation}" is unverified (bump the pin to a release that has it)`); continue; }
  const d = JSON.parse(readFileSync(rec, 'utf8')) as { chainId?: number; contractsGeneration?: number };
  const recorded = String(d.contractsGeneration ?? 1);
  if (d.chainId !== undefined && Number(d.chainId) !== town.chain.id) errors.push(`${town.town}: chain.id ${town.chain.id} but deployments-${town.chain.deployment}.json is chain ${d.chainId}`);
  if (recorded !== town.chain.generation) errors.push(`${town.town}: chain.generation "${town.chain.generation}" but deployments-${town.chain.deployment}.json records contractsGeneration ${recorded}`);
}
// ONE ROOT (ap-federation spec 440 §C1). A town whose names are rooted at another town names a town that exists, that is
// itself a root (no chain of roots), and that runs a naming service this town's can ask — otherwise "rooted at" is a
// sentence with nothing behind it, and the local table would quietly answer as a root again.
const byId = new Map(towns.map((t) => [t.town, t]));
for (const town of towns) {
  const at = town.chain.namesRootedAt;
  if (!at) continue;
  const root = byId.get(at);
  if (!root) { errors.push(`${town.town}: chain.namesRootedAt names "${at}", which is not a town this repository knows`); continue; }
  if (root.chain.namesRootedAt) errors.push(`${town.town}: rooted at ${at}, which is itself rooted at ${root.chain.namesRootedAt} — a namespace has one root`);
  if (!root.services.some((s) => s.id === 'naming' && s.hosts.length)) errors.push(`${town.town}: rooted at ${at}, whose manifest lists no naming service host to read the root from`);
  if (town.services.some((s) => s.id === 'naming' && s.repo === 'ap-town')) {
    // The rooted town's naming Worker must be able to reach the root's by service binding or its host; the binding is
    // checked by name here so a missing one is a finding, not a slow public fetch nobody notices.
    const toml = join(ROOT, 'apps/naming/wrangler.toml');
    const envs = [...wranglerFacts(toml).values()];
    const mine = envs.find((f) => f.name === town.services.find((s) => s.id === 'naming')!.worker);
    const rootWorker = root.services.find((s) => s.id === 'naming')?.worker;
    if (mine && rootWorker && !mine.services.includes(rootWorker)) errors.push(`${town.town}: apps/naming/wrangler.toml [${mine.name}] does not bind the root town's naming Worker "${rootWorker}" (PEER_${at.toUpperCase().replace(/-/g, '_')})`);
  }
}
if (errors.length) { console.error(`check:town — ${errors.length} finding(s):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`check:town — ${towns.length} town(s), ${checked} deployed service(s) agree with their apps`);
