// probe:town — the HEALTHY signal (spec 429 D7) for every listed service with a probe: one unauthenticated GET,
// 2xx = up. Prints the three signals the town can answer; never a combined score, never "authorized".
//   pnpm probe:town [town]        exit 1 when any probed service is down
import { loadTowns } from './load-towns';

const want = process.argv[2];
const { towns, errors } = loadTowns();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
let down = 0;
for (const town of towns.filter((t) => !want || t.town === want)) {
  console.log(`${town.town} (chain ${town.chain.id}, ${town.status}) — ${town.estates.length} estate(s): ${town.estates.map((e) => e.id).join(', ')}`);
  for (const s of town.services) {
    let healthy = 'unobserved';
    if (s.probe) {
      try {
        const r = await fetch(s.probe, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
        healthy = r.status >= 200 && r.status < 400 ? 'up' : `down (${r.status})`;
      } catch (e) { healthy = `down (${(e as Error).name})`; }
      if (healthy.startsWith('down')) down++;
    }
    console.log(`  ${s.id.padEnd(20)} ${s.kind.padEnd(12)} listed · ${healthy.padEnd(12)} ${s.repo}`);
  }
}
process.exit(down ? 1 : 0);
