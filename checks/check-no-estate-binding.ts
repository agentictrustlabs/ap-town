// check:no-estate-binding — spec 429 §5. A town service must not depend on any one estate, or a second estate would be
// a second-class resident. A town Worker may bind (a) another town Worker, or (b) an estate Worker the town manifest
// DECLARES as one of that estate's public lanes (a Worker cannot fetch a same-account hostname). Anything else — an
// estate's runtime, vault or edge bound for its own sake — is refused.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { declaredLaneWorkers } from '../packages/town-model/src/index';
import { loadTowns, ROOT } from './load-towns';
import { wranglerFacts } from './wrangler-facts';

const { towns, errors } = loadTowns();
const townWorkers = new Set(towns.flatMap((t) => t.services.filter((s) => s.repo === 'ap-town' && s.worker).map((s) => s.worker!)));
const lanes = new Set(towns.flatMap((t) => [...declaredLaneWorkers(t)]));
let bindings = 0;
for (const app of readdirSync(join(ROOT, 'apps'))) {
  const toml = join(ROOT, 'apps', app, 'wrangler.toml');
  if (!existsSync(toml)) continue;
  for (const [env, f] of wranglerFacts(toml)) {
    for (const svc of f.services) {
      bindings++;
      // Bindings within one app's own Worker family (default env ↔ default env) are town Workers by name.
      if (townWorkers.has(svc) || lanes.has(svc)) continue;
      errors.push(`apps/${app}/wrangler.toml [${env || 'top'}]: binds "${svc}", which is neither a town Worker nor a declared estate lane`);
    }
  }
}
if (errors.length) { console.error(`check:no-estate-binding — ${errors.length} finding(s):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`check:no-estate-binding — ${bindings} service binding(s), each a town Worker or a declared estate lane`);
