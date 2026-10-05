// check:town — every town manifest is valid, and every service this repository deploys is what its app says it is:
// the app directory exists, one of its wrangler environments deploys exactly that Worker name, and the hosts the
// manifest lists are the custom domains that environment claims. A manifest that disagrees with the deployables is a
// manifest that lies to the portal (spec 429 D6).
import { existsSync } from 'node:fs';
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
if (errors.length) { console.error(`check:town — ${errors.length} finding(s):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`check:town — ${towns.length} town(s), ${checked} deployed service(s) agree with their apps`);
