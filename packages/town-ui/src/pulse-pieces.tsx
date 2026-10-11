// Pieces the Pulse draws with (spec 434 §10.4): a stat tile, a sparkline, an up/down strip, a window picker, a
// utilisation bar. Plain SVG and CSS — no chart library; every number shown is one the API returned.
import type { ReactNode } from 'react';

/**
 * One figure. `value={null}` means there is NO figure — not a figure of zero — and `absent` says why in words,
 * set quietly so it can never be mistaken for the number. A withheld operator amount and an unrecorded metric
 * are both absences, and both say so rather than printing a word where a number belongs (spec 434 §10).
 */
export function Stat({ label, value, sub, tone, absent = 'not recorded yet' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'muted'; absent?: string }): ReactNode {
  const none = value === null || value === undefined;
  // A value that is a WORD rather than a figure ("operator", "withheld") is set smaller, because a card
  // sized for a four-digit count is not wide enough for one at the figure size: `operator` was breaking
  // across lines as "operato / r", which reads as a typo and not as a word.
  const word = !none && typeof value === 'string' && /^[A-Za-z][A-Za-z ']*$/.test(value);
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value${none ? ' stat-value-none' : ''}${word ? ' stat-value-word' : ''}`}>{none ? absent : value}</span>
      {sub !== undefined && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Sparkline({ points, width = 160, height = 36, label }: { points: Array<number | null>; width?: number; height?: number; label?: string }): ReactNode {
  const xs = points.map((p, i) => [i, p] as const).filter((x): x is readonly [number, number] => typeof x[1] === 'number');
  if (xs.length < 2) return <span className="spark spark-empty" aria-label={label}>—</span>;
  const max = Math.max(1, ...xs.map(([, v]) => v)), min = Math.min(0, ...xs.map(([, v]) => v));
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => (i / n) * (width - 2) + 1, y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const d = xs.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = xs[xs.length - 1]!;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label ?? `${xs.length} points, latest ${last[1]}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r="2.2" fill="currentColor" />
    </svg>
  );
}

/** One cell per step: up (ok), down (bad), or no sample (muted). */
export function UpStrip({ cells, label }: { cells: Array<boolean | null>; label?: string }): ReactNode {
  return <span className="upstrip" role="img" aria-label={label ?? `${cells.filter((c) => c === true).length} of ${cells.length} intervals up`}>{cells.map((c, i) => <span key={i} className={`upcell ${c === true ? 'upcell-ok' : c === false ? 'upcell-bad' : 'upcell-none'}`} />)}</span>;
}

export type PulseWindow = '24h' | '7d' | '30d' | '90d';
export function WindowPicker({ value, onChange, windows = ['24h', '7d', '30d'] }: { value: PulseWindow; onChange: (w: PulseWindow) => void; windows?: PulseWindow[] }): ReactNode {
  return (
    <div className="window-picker" role="group" aria-label="Window">
      {windows.map((w) => <button key={w} type="button" className={`button button-quiet${w === value ? ' is-on' : ''}`} aria-pressed={w === value} onClick={() => onChange(w)}>{w}</button>)}
    </div>
  );
}

/** Spec 437 I2 — "real time" is labelled per source, never implied. */
export const LAG_LABEL: Record<string, string> = { live: 'live', '5min': '~5 min', hourly: 'hourly', 'daily-restated': 'daily · restated up to 72 h' };
export function LagBadge({ lag }: { lag: string | null | undefined }): ReactNode {
  return <span className="chip chip-muted lag" title="How current this source's numbers can be">{lag ? LAG_LABEL[lag] ?? lag : 'lag unknown'}</span>;
}
/** Spec 437 I2 — derived (meter × published price) and billed are never summed without the label. */
const BASIS_TITLE: Record<string, string> = {
  billed: "What the provider says it invoiced for the period",
  effective: "What the period consumed once committed and subscription spend is amortised — real money, but not a line on this invoice",
  derived: 'A meter times a published unit price — our estimate, not a bill',
};
export function BasisBadge({ basis }: { basis: 'derived' | 'billed' | 'effective' }): ReactNode {
  return <span className={`chip ${basis === 'billed' ? 'chip-ok' : basis === 'effective' ? 'chip-warn' : 'chip-free'}`} title={BASIS_TITLE[basis] ?? basis}>{basis}</span>;
}
export const fmtBytes = (b: number | null | undefined): string => { if (b === null || b === undefined) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, x = b; while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; } return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${u[i]}`; };
export const fmtPct = (r: number | null | undefined, digits = 1): string => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(digits)}%`);

export function Bar({ ratio, label }: { ratio: number | null; label?: string }): ReactNode {
  if (ratio === null) return <span className="quiet">no limit</span>;
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return <span className="bar" role="img" aria-label={label ?? `${pct}% of the limit`}><span className={`bar-fill${pct >= 90 ? ' bar-bad' : pct >= 70 ? ' bar-warn' : ''}`} style={{ width: `${pct}%` }} /><span className="bar-text">{pct}%</span></span>;
}

export const fmtInt = (n: number): string => Intl.NumberFormat('en-US').format(Math.round(n));
export const fmtUsd = (microUsd: number): string => `$${(microUsd / 1_000_000).toFixed(microUsd >= 1_000_000 ? 2 : 4)}`;
export const fmtMs = (ms: number | null | undefined): string => (ms === null || ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
export const fmtAgo = (iso: string | null | undefined, now = Date.now()): string => { if (!iso) return 'never'; const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172_800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`; };
