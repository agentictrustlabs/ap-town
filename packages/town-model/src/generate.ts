// Generators: the configuration a town app reads, derived from the manifest so that a second estate is a manifest edit,
// never a code edit (spec 429 §4).
import type { TownManifest } from './types';

/** The union of every estate's name roots, in first-seen order — what the indexer crawls. */
export function crawlRoots(town: TownManifest): string[] {
  const seen = new Set<string>();
  for (const e of town.estates) for (const r of e.nameRoots) seen.add(r);
  return [...seen];
}

/**
 * The indexer's lane routes: each same-account estate host pattern → the service-binding name that reaches it.
 * Binding names are per estate and per Worker (`LANE_<ESTATE>_<n>`), so two estates never share one binding.
 */
export interface LaneBinding { binding: string; service: string; pattern: string; estate: string }

export function laneBindings(town: TownManifest): LaneBinding[] {
  const out: LaneBinding[] = [];
  for (const e of town.estates) {
    const byWorker = new Map<string, string>();
    for (const [pattern, worker] of Object.entries(e.lanes ?? {})) {
      let binding = byWorker.get(worker);
      if (!binding) {
        binding = `LANE_${e.id.toUpperCase().replace(/-/g, '_')}_${byWorker.size + 1}`;
        byWorker.set(worker, binding);
      }
      out.push({ binding, service: worker, pattern, estate: e.id });
    }
  }
  return out;
}

/** `LANE_ROUTES` as the indexer reads it: `pattern=BINDING,…`. */
export function laneRoutesVar(town: TownManifest): string {
  return laneBindings(town).map((l) => `${l.pattern}=${l.binding}`).join(',');
}

/** The estate Worker names a town Worker is ALLOWED to bind — only those the manifest declares as lanes. */
export function declaredLaneWorkers(town: TownManifest): Set<string> {
  return new Set(laneBindings(town).map((l) => l.service));
}
