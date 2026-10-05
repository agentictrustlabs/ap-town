// discovery.faithnet.io — the discovery explorer's assets, plus the registry's public documents at the paths a client
// looks for on THIS host. The explorer is a page; a client asking this host for `/.well-known/ard.json` wants the
// registry's ARD document, not the page's HTML (spec 349 F4; spec 429 §6.2). Served through the REGISTRY service
// binding to the town's registry Worker (a Worker cannot fetch a same-account host by URL), byte for byte, with the
// registry's own status and headers. Everything else is the static explorer.
interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  REGISTRY: { fetch(req: Request): Promise<Response> };
}

/** The registry's public documents — the only paths this host passes through. */
export const REGISTRY_PATHS = ['/.well-known/ard.json', '/registry/v1/latest/registry.json'] as const;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if ((REGISTRY_PATHS as readonly string[]).includes(url.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      return env.REGISTRY.fetch(new Request(`https://registry${url.pathname}${url.search}`, { method: req.method, headers: { accept: 'application/json' } }));
    }
    return env.ASSETS.fetch(req);
  },
};
