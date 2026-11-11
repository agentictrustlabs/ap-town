// The bounded read of the sample store, run on a real SQLite: a 30-day window answered by one row per source per bucket, keeping what each
// reader draws from a bucket. A month of raw samples killed the Durable Object's isolate (2026-11-06).
// @ts-expect-error this repo's @types/node predates node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyBucket, BUCKET_READ, DAILY_BEATS_READ, readPulse, type BucketRow, type PulseSampleV1 } from '../worker/pulse';
import { stepMsOf } from '../worker/pulse-perf';

const FIVE_MIN = 300_000;
const NOW = Date.UTC(2026, 10, 6, 12);
let db: DatabaseSync;
const put = (kind: string, id: string, at: number, ok: boolean, payload: unknown = {}) => db.prepare('INSERT INTO samples (kind, id, at, ok, json) VALUES (?, ?, ?, ?, ?)').run(kind, id, at, ok ? 1 : 0, JSON.stringify({ kind, id, at: new Date(at).toISOString(), ok, payload }));
const read = (step: number, from: number) => (db.prepare(BUCKET_READ).all(step, from) as unknown as BucketRow[]).map(applyBucket).map((r) => JSON.parse(r.json) as PulseSampleV1);

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE samples (kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, json TEXT NOT NULL); CREATE INDEX samples_kind_id_at ON samples(kind, id, at);');
});

describe('the bucketed read', () => {
  const step = stepMsOf('30d');
  const from = NOW - 30 * 86_400_000;

  it('answers a month of five-minute samples with at most 97 rows per source', () => {
    for (let at = from; at < NOW; at += FIVE_MIN) { put('service', 'edge', at, true); put('estate', 'faithnet', at, true); }
    const rows = read(step, from);
    expect(rows.filter((r) => r.id === 'edge').length).toBeLessThanOrEqual(97);
    expect(rows.filter((r) => r.id === 'faithnet').length).toBeLessThanOrEqual(97);
  });
  it('a service down at any moment of a bucket stays down, though its last probe was up', () => {
    const b = Math.floor(NOW / step) * step - step;
    put('service', 'edge', b + 1000, true);
    put('service', 'edge', b + 2000, false);
    put('service', 'edge', b + 3000, true);
    const [row] = read(step, from);
    expect(row!.ok).toBe(false);
  });
  it('a source reads its last good sample in a bucket, not a failure after it', () => {
    const b = Math.floor(NOW / step) * step - step;
    put('chain', 'chain-gateway', b + 1000, true, { totals: { requests: 7 } });
    put('chain', 'chain-gateway', b + 2000, false);
    const [row] = read(step, from);
    expect(row!.ok).toBe(true);
    expect(row!.payload).toEqual({ totals: { requests: 7 } });
  });
  it('a bucket with no good sample still answers, as not good', () => {
    const b = Math.floor(NOW / step) * step - step;
    put('estate', 'faithnet', b + 1000, false);
    expect(read(step, from)[0]!.ok).toBe(false);
  });
  it('keeps each estate\'s last good heartbeat of each day, though a bucket straddles midnight', () => {
    const midnight = Math.floor(NOW / 86_400_000) * 86_400_000 - 86_400_000;
    const late = midnight - FIVE_MIN; // the last beat of the day before
    put('estate', 'faithnet', late, true);
    put('estate', 'faithnet', midnight + FIVE_MIN, true); // the same bucket, when one spans this midnight
    const stepAcross = 7.5 * 3_600_000;
    const daily = (db.prepare(DAILY_BEATS_READ).all(from) as Array<{ json: string }>).map((r) => JSON.parse(r.json) as PulseSampleV1);
    expect(daily.map((d) => Date.parse(d.at))).toEqual([late, midnight + FIVE_MIN]);
    expect(stepAcross).toBe(step);
  });
  it('leaves out what is older than the window', () => {
    put('estate', 'faithnet', from - 86_400_000, true);
    expect(read(step, from)).toEqual([]);
  });
  it('draws the same series readPulse would from every sample', () => {
    const town = { town: 't', services: [{ id: 'edge' }], estates: [{ id: 'faithnet' }] } as never;
    for (let at = from; at < NOW; at += FIVE_MIN) { put('service', 'edge', at, at % (step * 3) !== 0); put('chain', 'chain-gateway', at, true, { totals: { requests: at } }); }
    const all = (db.prepare('SELECT json FROM samples ORDER BY at').all() as Array<{ json: string }>).map((r) => JSON.parse(r.json) as PulseSampleV1);
    const whole = readPulse(town, all, '30d', NOW);
    const bounded = readPulse(town, read(step, from), '30d', NOW);
    expect(bounded.window.stepMs).toBe(step);
    expect(bounded.services.edge!.series).toEqual(whole.services.edge!.series);
    expect(bounded.chain.series).toEqual(whole.chain.series);
  });
});
