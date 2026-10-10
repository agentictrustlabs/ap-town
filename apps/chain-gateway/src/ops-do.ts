// THE ROLLUP OBJECT — one for the whole gateway (`idFromName('ops')`): per-minute rows in SQL, 30 days, pruned by alarm.
// SERVING PLANE: wiping it loses trend lines, never a token (tokens are KV rows the steward wrote) — spec 436 §6.4.
import { emptyRow, fold, summarize, type MinuteRow, type Sample } from './ops';

const RETENTION_MS = 30 * 86_400_000;
const PRUNE_EVERY_MS = 60 * 60_000;

type Row = { minute: number; app: string; estate: string | null; kind: string; method: string; data: string };

export class ChainOpsDO {
  private readonly sql: SqlStorage;
  constructor(private readonly state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS minutes (minute INTEGER NOT NULL, app TEXT NOT NULL, method TEXT NOT NULL, estate TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (minute, app, method));
      CREATE INDEX IF NOT EXISTS minutes_minute ON minutes(minute);
      CREATE TABLE IF NOT EXISTS head (k TEXT PRIMARY KEY, head INTEGER NOT NULL, at INTEGER NOT NULL);`);
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/record' && req.method === 'POST') {
      const samples = (await req.json()) as Sample[];
      for (const s of samples) {
        const cur = this.sql.exec<Row>('SELECT data FROM minutes WHERE minute = ? AND app = ? AND method = ?', s.minute, s.app, s.method).toArray()[0];
        const row = fold(cur ? (JSON.parse(cur.data) as MinuteRow) : emptyRow(s), s);
        this.sql.exec('INSERT OR REPLACE INTO minutes (minute, app, method, estate, kind, data) VALUES (?, ?, ?, ?, ?, ?)', s.minute, s.app, s.method, s.estate, s.kind, JSON.stringify(row));
      }
      if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + PRUNE_EVERY_MS);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/head' && req.method === 'POST') {
      const { head } = (await req.json()) as { head: number };
      const cur = this.sql.exec<{ head: number; at: number }>("SELECT head, at FROM head WHERE k = 'latest'").toArray()[0];
      if (cur && cur.head !== head) this.sql.exec("INSERT OR REPLACE INTO head (k, head, at) VALUES ('prev', ?, ?)", cur.head, cur.at);
      this.sql.exec("INSERT OR REPLACE INTO head (k, head, at) VALUES ('latest', ?, ?)", head, Date.now());
      return Response.json({ ok: true });
    }
    if (url.pathname === '/summary') {
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      const estate = url.searchParams.get('estate'), app = url.searchParams.get('app');
      const limits = JSON.parse(url.searchParams.get('limits') ?? '{}') as Record<string, { readRps: number; writeRps: number }>;
      const rows = this.sql.exec<Row>('SELECT * FROM minutes WHERE minute >= ? AND minute <= ?', Math.floor(from / 60_000), Math.ceil(to / 60_000)).toArray()
        .map((r) => JSON.parse(r.data) as MinuteRow).filter((r) => (!estate || r.estate === estate) && (!app || r.app === app));
      const heads = Object.fromEntries(this.sql.exec<{ k: string; head: number; at: number }>('SELECT k, head, at FROM head').toArray().map((h) => [h.k, h]));
      const head = heads.latest ? { head: heads.latest.head, at: heads.latest.at, ...(heads.prev ? { prev: { head: heads.prev.head, at: heads.prev.at } } : {}) } : null;
      return Response.json(summarize(rows, { from, to, limits, head, generation: url.searchParams.get('generation') ?? '', now: Date.now() }));
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  async alarm(): Promise<void> {
    this.sql.exec('DELETE FROM minutes WHERE minute < ?', Math.floor((Date.now() - RETENTION_MS) / 60_000));
    await this.state.storage.setAlarm(Date.now() + PRUNE_EVERY_MS);
  }
}
