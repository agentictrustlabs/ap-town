/**
 * Spec 434 §3 / §9 — REGISTER A CLIENT of the town's model gateway: a principal (an app's Service SA) gets an app key
 * and an entitlement (which profiles, which limits, which estate it is attributed to). The key is generated here, shown
 * ONCE, and only its sha256 is written: the Worker resolves `client:<hash>` → the principal (caller class a). The
 * entitlement is the gateway's own policy over its own resource — never a delegation (G8; 429 D2).
 *
 *   npx tsx scripts/inference-client.mts <principal-sa> <estate|-> <estate-app|town-service|application> <profiles,csv|*> [--label name] [--usd-per-day 5] [--rpm 60] [--concurrency 8] [--env faithnet] [--dry-run]
 *
 * Writes three KV rows through wrangler (CACHE binding of apps/inference): client:<sha256(key)>, entitlement:<sa>, clients:principals.
 * The vault record (`inference.client:<sa>`) is W6's steward write; until then KV is the serving copy and this script's
 * output (addresses + hash, never the key) is the ledger — keep it in operations/inference-clients.faithchain.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && !['--dry-run'].includes(args[i - 1]!)));
const [principal, estateArg, kind, profilesArg] = positional;
if (!principal || !/^0x[0-9a-fA-F]{40}$/.test(principal) || !kind || !profilesArg) {
  console.error('usage: inference-client.mts <principal-sa> <estate|-> <estate-app|town-service|application> <profiles,csv|*> [--label n] [--usd-per-day 5] [--rpm 60] [--concurrency 8] [--env faithnet] [--dry-run]');
  process.exit(2);
}
if (!['estate-app', 'town-service', 'application'].includes(kind)) { console.error(`kind must be estate-app | town-service | application, got ${kind}`); process.exit(2); }
const estate = estateArg && estateArg !== '-' ? estateArg : undefined;
const profiles = profilesArg === '*' ? ['*'] : profilesArg.split(',').map((s) => s.trim()).filter(Boolean);
const usdPerDay = Number(flag('usd-per-day', '5'));
const rpm = Number(flag('rpm', '60'));
const concurrency = Number(flag('concurrency', '8'));
const env = flag('env', 'faithnet')!;
const dry = args.includes('--dry-run');

const key = `apk_${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(key).digest('hex');
const sa = principal.toLowerCase();
const entitlement = { principal: sa, ...(estate ? { estate } : {}), kind, ...(flag('label') ? { label: flag('label') } : {}), profiles, limits: { '*': { microUsdPerDay: Math.round(usdPerDay * 1_000_000), requestsPerMinute: rpm, concurrency, maxAttempts: 2 } }, validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString() };
const client = { principal: sa, principalClass: 'app', ...(estate ? { estate } : {}), clientKind: kind };

const kvPut = (k: string, v: string) => {
  const cmd = ['wrangler', 'kv', 'key', 'put', '--binding', 'CACHE', '--env', env, '--remote', k, v];
  if (dry) { console.log(`[dry-run] ${cmd.join(' ').slice(0, 200)}…`); return; }
  execFileSync('npx', ['-y', ...cmd], { cwd: new URL('../apps/inference', import.meta.url).pathname, stdio: 'inherit' });
};
const kvGet = (k: string): string | null => {
  if (dry) return null;
  try { return execFileSync('npx', ['-y', 'wrangler', 'kv', 'key', 'get', '--binding', 'CACHE', '--env', env, '--remote', k], { cwd: new URL('../apps/inference', import.meta.url).pathname, encoding: 'utf8' }).trim() || null; } catch { return null; }
};

kvPut(`client:${hash}`, JSON.stringify(client));
kvPut(`entitlement:${sa}`, JSON.stringify(entitlement));
const existing = (() => { try { return JSON.parse(kvGet('clients:principals') ?? '[]') as string[]; } catch { return []; } })();
kvPut('clients:principals', JSON.stringify([...new Set([...existing, sa])]));

const ledgerPath = new URL('../operations/inference-clients.faithchain.json', import.meta.url).pathname;
const ledger = existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, 'utf8')) as { clients: unknown[] }) : { clients: [] };
ledger.clients = [...ledger.clients.filter((c) => (c as { principal: string }).principal !== sa), { principal: sa, estate, kind, label: flag('label'), profiles, keyHash: hash, registeredAt: new Date().toISOString().slice(0, 10) }];
if (!dry) writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');

console.log(`\nclient registered: ${sa}${estate ? ` (estate ${estate})` : ''} · ${kind} · profiles ${profiles.join(', ')}`);
console.log(`limits: $${usdPerDay}/day · ${rpm} rpm · ${concurrency} concurrent · 2 attempts`);
console.log(`key hash (in KV + operations ledger): ${hash}`);
console.log(`\nAPP KEY — shown once, never stored:\n  ${key}\n\nSet it on the client as its secret (e.g. wrangler secret put INFERENCE_APP_KEY --env faithnet).`);
