// THE METER — spec 434 §5. One Durable Object per PRINCIPAL: `reserve` before dispatch, `settle` after, `hold` when the
// attempt ended without usage, an alarm that sweeps held reservations (reconcile what can be read back — nothing yet in
// v1 — and EXPIRE the rest at the reserved cost, never zero). The algebra is Ring 0's (`@agenticprimitives/model-gateway`
// `budget.ts`, pure); this object gives it the single-threaded storage that makes a reservation atomic.
// SERVING PLANE (ADR-0055): the state here is derived; receipts are the record (inference.svc's vault). The receipts
// table kept here for 30 days is the Pulse's rollup source and is what `rebuildFromReceipts` restores the counters from.
import {
  reserve, settle, expire, stale, rollDay, emptyBudget, rebuildFromReceipts, summarizeReceipts, utilisation,
  type BudgetStateV1, type BudgetLimitsV1, type ModelUsageV1, type InferenceReceiptV1, type InferenceOpsSummaryV1,
} from '@agenticprimitives/model-gateway';

export const HOLD_SWEEP_MS = 10 * 60_000;
export const RECEIPT_RETENTION_DAYS = 30;
const STATE_KEY = 'budget:state';
const ALARM_MS = 5 * 60_000;

export type BudgetOp =
  | { op: 'reserve'; profile: string; estimateTokens: number; estimateMicroUsd: number; limits: BudgetLimitsV1 }
  | { op: 'settle'; reservationId: string; usage: ModelUsageV1; costMicroUsd: number }
  | { op: 'hold'; reservationId: string }
  | { op: 'receipt'; receipt: InferenceReceiptV1 }
  | { op: 'summary'; from: string; to: string }
  | { op: 'utilisation'; profile: string; limits: BudgetLimitsV1 }
  | { op: 'state' };

export class BudgetDO {
  private readonly sql: SqlStorage;
  constructor(private readonly state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, at INTEGER NOT NULL, profile TEXT NOT NULL, reservation TEXT, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS receipts_at ON receipts(at);`);
  }

  private async load(now: number): Promise<BudgetStateV1> {
    const s = await this.state.storage.get<BudgetStateV1>(STATE_KEY);
    return s ? rollDay(s, now) : emptyBudget(now);
  }
  private async save(s: BudgetStateV1): Promise<void> { await this.state.storage.put(STATE_KEY, s); }
  private async ensureAlarm(): Promise<void> { if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + ALARM_MS); }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as BudgetOp | null;
    if (!body || typeof body !== 'object' || !('op' in body)) return Response.json({ error: 'a budget op is required' }, { status: 400 });
    const now = Date.now();
    switch (body.op) {
      case 'reserve': {
        const s = await this.load(now);
        const r = reserve(s, { id: crypto.randomUUID(), profile: body.profile, estimateTokens: body.estimateTokens, estimateMicroUsd: body.estimateMicroUsd, limits: body.limits, now });
        await this.save(r.state); await this.ensureAlarm();
        return Response.json(r.ok ? { ok: true, reservationId: r.reservationId } : { ok: false, reason: r.reason, detail: r.detail });
      }
      case 'settle': {
        const s = await this.load(now);
        const r = settle(s, { reservationId: body.reservationId, usage: body.usage, costMicroUsd: body.costMicroUsd, now });
        await this.save(r.state);
        return Response.json({ ok: true, settled: r.settled });
      }
      case 'hold': {
        await this.ensureAlarm();
        return Response.json({ ok: true });
      }
      case 'receipt': {
        const r = body.receipt;
        this.sql.exec('INSERT OR REPLACE INTO receipts (id, at, profile, reservation, json) VALUES (?, ?, ?, ?, ?)', r.id, Date.parse(r.at), r.profile, r.reservationId ?? null, JSON.stringify(r));
        return Response.json({ ok: true });
      }
      case 'summary': {
        const from = Date.parse(body.from), to = Date.parse(body.to);
        const rows = this.sql.exec<{ json: string }>('SELECT json FROM receipts WHERE at >= ? AND at <= ? ORDER BY at', from, to).toArray();
        const receipts = rows.map((x) => JSON.parse(x.json) as InferenceReceiptV1);
        const summary: InferenceOpsSummaryV1 = summarizeReceipts(receipts, { from: body.from, to: body.to });
        return Response.json(summary);
      }
      case 'utilisation': {
        const s = await this.load(now);
        return Response.json(utilisation(s, body.profile, body.limits, now));
      }
      case 'state': {
        return Response.json(await this.load(now));
      }
      default:
        return Response.json({ error: `unknown op ${(body as { op: string }).op}` }, { status: 400 });
    }
  }

  /** The sweep: held reservations past HOLD_SWEEP_MS are expired at the reserved cost; their pending receipts marked expired; old receipts pruned. */
  async alarm(): Promise<void> {
    const now = Date.now();
    let s = await this.load(now);
    const held = stale(s, now, HOLD_SWEEP_MS);
    for (const r of held) {
      const ex = expire(s, { reservationId: r.id, now }); s = ex.state;
      const rows = this.sql.exec<{ id: string; json: string }>('SELECT id, json FROM receipts WHERE reservation = ?', r.id).toArray();
      for (const row of rows) {
        const rec = JSON.parse(row.json) as InferenceReceiptV1;
        if (rec.reconciliation === 'pending') { const next = { ...rec, reconciliation: 'expired' as const, costMicroUsd: ex.chargedMicroUsd }; this.sql.exec('UPDATE receipts SET json = ? WHERE id = ?', JSON.stringify(next), row.id); }
      }
    }
    await this.save(s);
    this.sql.exec('DELETE FROM receipts WHERE at < ?', now - RECEIPT_RETENTION_DAYS * 86_400_000);
    if (Object.keys(s.reservations).length) await this.state.storage.setAlarm(now + ALARM_MS);
  }

  /** Receipts are the record: a wiped state is rebuilt from the day's receipts (called by `state` readers when the key is absent). */
  async rebuild(now: number): Promise<BudgetStateV1> {
    const rows = this.sql.exec<{ json: string }>('SELECT json FROM receipts WHERE at >= ?', now - 86_400_000).toArray();
    const s = rebuildFromReceipts(now, rows.map((x) => JSON.parse(x.json) as InferenceReceiptV1));
    await this.save(s);
    return s;
  }
}
