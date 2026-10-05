// discovery.faithnet.io — the discovery explorer's old home. The explorer is folded into the Town portal's Find area
// (spec 429 §7.3), so a visitor is sent there, with their question. The registry's public documents stay at the paths a
// client looks for on THIS host (spec 349 F4; spec 429 §6.2), served through the REGISTRY service binding to the
// town's registry Worker, byte for byte, with the registry's own status and headers.
interface Env {
  REGISTRY: { fetch(req: Request): Promise<Response> };
  /** Where the explorer lives now: the portal's Find page. */
  PORTAL_FIND: string;
}

/** The registry's public documents — the only paths this host passes through. */
export const REGISTRY_PATHS = ['/.well-known/ard.json', '/registry/v1/latest/registry.json'] as const;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if ((REGISTRY_PATHS as readonly string[]).includes(url.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      return env.REGISTRY.fetch(new Request(`https://registry${url.pathname}${url.search}`, { method: req.method, headers: { accept: 'application/json' } }));
    }
    const to = new URL(env.PORTAL_FIND);
    const q = url.searchParams.get('q');
    if (q) to.searchParams.set('q', q);
    return Response.redirect(to.toString(), 302);
  },
};
