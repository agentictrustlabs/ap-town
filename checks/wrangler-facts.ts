// Minimal, line-based facts from a wrangler.toml — enough for the town checks, with no TOML dependency.
// Per environment ('' = the top level): the Worker name, the custom-domain route patterns, the services it binds.
import { readFileSync } from 'node:fs';

export interface EnvFacts { name?: string; routes: string[]; services: string[] }

export function wranglerFacts(file: string): Map<string, EnvFacts> {
  const envs = new Map<string, EnvFacts>();
  const get = (env: string) => { let f = envs.get(env); if (!f) { f = { routes: [], services: [] }; envs.set(env, f); } return f; };
  let env = '';
  let section = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const header = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (header) {
      const parts = header[1]!.trim().split('.');
      if (parts[0] === 'env' && parts[1]) { env = parts[1]; section = parts.slice(2).join('.'); } else { env = ''; section = parts.join('.'); }
      get(env);
      continue;
    }
    const kv = line.match(/^\s*([\w]+)\s*=\s*"([^"]*)"/);
    if (kv) {
      const [, k, v] = kv;
      if (k === 'name' && section === '') get(env).name = v;
      if (k === 'pattern' && section === 'routes') get(env).routes.push(v!);
      if (k === 'service' && section === 'services') get(env).services.push(v!);
    }
    for (const m of line.matchAll(/\{\s*pattern\s*=\s*"([^"]+)"/g)) get(env).routes.push(m[1]!);
  }
  return envs;
}
