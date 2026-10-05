// check:no-estate-binding — spec 429 §5. A town service must not depend on any one estate, or a second estate would be
// a second-class resident. A town Worker may bind (a) another town Worker, or (b) an estate Worker the town manifest
// DECLARES as one of that estate's public lanes (a Worker cannot fetch a same-account workers.dev host) — and (b) only
// inside a block `pnpm gen:town` wrote from the manifest. An estate Worker bound by hand, or any other estate Worker
// (its runtime, vault or edge bound for its own sake), is refused.
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declaredLaneWorkers } from '../packages/town-model/src/core';
import { loadTowns, ROOT } from './load-towns';
import { wranglerFacts } from './wrangler-facts';

const { towns, errors } = loadTowns();
const townWorkers = new Set(towns.flatMap((t) => t.services.filter((s) => s.repo === 'ap-town' && s.worker).map((s) => s.worker!)));
const lanes = new Set(towns.flatMap((t) => [...declaredLaneWorkers(t)]));
let bindings = 0;
for (const app of readdirSync(join(ROOT, 'apps'))) {
  const toml = join(ROOT, 'apps', app, 'wrangler.toml');
  if (!existsSync(toml)) continue;
  // Judge the file with its generated lane blocks removed: what is left was written by hand.
  const handWritten = join(mkdtempSync(join(tmpdir(), 'town-')), 'wrangler.toml');
  writeFileSync(handWritten, readFileSync(toml, 'utf8').replace(/# >>> town:lanes (\S+)[\s\S]*?# <<< town:lanes \1/g, ''));
  for (const [env, f] of wranglerFacts(handWritten)) {
    for (const svc of f.services) {
      bindings++;
      if (townWorkers.has(svc)) continue;
      errors.push(lanes.has(svc)
        ? `apps/${app}/wrangler.toml [${env || 'top'}]: binds estate lane "${svc}" by hand — lanes come from the town manifest (\`pnpm gen:town\`)`
        : `apps/${app}/wrangler.toml [${env || 'top'}]: binds "${svc}", which is neither a town Worker nor a declared estate lane`);
    }
  }
}
if (errors.length) { console.error(`check:no-estate-binding — ${errors.length} finding(s):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`check:no-estate-binding — ${bindings} service binding(s), each a town Worker or a declared estate lane`);
