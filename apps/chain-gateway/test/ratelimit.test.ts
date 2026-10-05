import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/ratelimit';

const limiter = () => {
  const m = new Map<string, unknown>();
  const state = { storage: { get: async (k: string) => m.get(k), put: async (k: string, v: unknown) => { m.set(k, v); } } };
  return new RateLimiter(state as never);
};
const take = (rl: RateLimiter, body: object) => rl.fetch(new Request('https://rl/take', { method: 'POST', body: JSON.stringify(body) })).then((r) => r.json());

describe('RateLimiter', () => {
  it('a read-only token is REFUSED a write, with no retry time', async () => {
    expect(await take(limiter(), { reads: 0, writes: 1, readRps: 5, writeRps: 0 })).toEqual({ ok: false, denied: 'writes' });
  });
  it('a budgeted kind waits with a finite retry time', async () => {
    const rl = limiter();
    for (let i = 0; i < 2; i++) expect(await take(rl, { reads: 1, writes: 0, readRps: 1, writeRps: 0 })).toEqual({ ok: true });
    const r = await take(rl, { reads: 1, writes: 0, readRps: 1, writeRps: 0 }) as { ok: boolean; retryAfter: number };
    expect(r.ok).toBe(false);
    expect(Number.isFinite(r.retryAfter)).toBe(true);
  });
});
