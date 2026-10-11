// PUBLIC LANES — how a town Worker reaches an estate Worker it cannot fetch directly. The manifest declares
// the lane, `pnpm gen:town` writes the binding, and this resolves one at request time.

/** The one surface a lane binding is used through. Satisfied by a Cloudflare service binding. */
export interface LaneFetcher { fetch(req: Request): Promise<Response>; }

/**
 * The service binding that carries a request to `host`, or null when no declared lane covers it.
 *
 * A Worker cannot fetch a same-account `workers.dev` host — the request comes back 404, which reads as
 * "that endpoint is gone" and not as "this hop is impossible". So an estate whose hosts are workers.dev
 * ones declares them as LANES in the town manifest, `pnpm gen:town` writes the bindings, and a town
 * Worker reaches them through this. A lane is REACH, never authority: the bytes still arrive at that
 * estate's own door and are admitted there on their own merits.
 *
 * Throws when LANE_ROUTES names a binding the deployment does not have — a missing binding is a
 * misdeployment to say out loud, never a silent fall back to the direct fetch that cannot work.
 */
export function laneBindingFor(env: { LANE_ROUTES?: string }, host: string): LaneFetcher | null {
  for (const route of (env.LANE_ROUTES ?? '').split(',').map((r) => r.trim()).filter(Boolean)) {
    const [pattern, name] = route.split('=').map((x) => x.trim());
    if (!pattern || !name) continue;
    const hit = pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern;
    if (!hit) continue;
    const b = (env as unknown as Record<string, unknown>)[name] as LaneFetcher | undefined;
    if (!b) throw new Error(`LANE_ROUTES sends ${host} to ${name}, which is not bound`);
    return b;
  }
  return null;
}
